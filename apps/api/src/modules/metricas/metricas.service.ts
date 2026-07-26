import { Injectable } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';

/**
 * El dominio `metricas` · el Dashboard Administrativo.
 *
 * Responde a una pregunta distinta de la del Auditor. El Auditor pregunta "¿qué
 * hago con ESTE artículo?"; la gerencia pregunta "¿en qué bodegas se está
 * perdiendo plata y desde cuándo?". Son dos productos, y mezclarlos produce una
 * pantalla que no sirve para ninguna de las dos cosas.
 *
 * Tres decisiones que explican todo lo demás:
 *
 * · **Se cuentan REFERENCIAS, no unidades.** Lo pidió el cliente de forma
 *   explícita y cambia cada consulta: 300 panes faltantes es UNA referencia con
 *   faltante, no 300. Sumar unidades daría un número enorme y sin significado,
 *   porque mezcla kilos con litros y con unidades sueltas.
 *
 * · **El histórico sale de la foto del cierre, no de la proyección viva.**
 *   `articulo_consolidado` se recalcula entera cada vez que cierra una ronda:
 *   preguntarle por enero en marzo devuelve lo que se concluiría hoy, no lo que
 *   se avaló entonces. El histórico lee `consolidado_historico`, que se escribe
 *   una vez y no se toca más.
 *
 * · **El mes en curso se puede mirar antes de cerrarlo.** El compañero lo
 *   planteó como un informe de cierre, y lo es; pero negarle a la gerencia ver
 *   cómo va el mes solo porque nadie ha firmado todavía es una limitación del
 *   sistema, no del negocio. Cada cifra viaja con su `fuente`: `cierre` cuando
 *   está avalada, `proyeccion` cuando todavía se mueve.
 */

/** Un mes, tal como se nombra: `2026-07`. */
export type Periodo = string;

export interface Kpi {
  /** Referencias que alguna ronda afirmó haber contado. */
  readonly contadas: number;
  /** Contadas que coincidieron con el sistema sin levantar bandera. */
  readonly sinDiferencia: number;
  /** Contadas que sí levantaron bandera: el conteo no cuadró con el ERP. */
  readonly conDiferencia: number;
  /** De esas, las que el Auditor explicó y dejaron de tener diferencia. */
  readonly aclaradas: number;
  /** Faltantes reales: tras el Auditor, sigue habiendo menos de lo que decía el sistema. */
  readonly faltantes: number;
  /** Sobrantes reales: sigue habiendo más. */
  readonly sobrantes: number;
  /** Hallazgos: estaban físicamente en la bodega y no existen en el ERP. */
  readonly fantasmas: number;
  /** Referencias del catálogo que nadie contó. */
  readonly sinCobertura: number;
  /** Con diferencia y sin causa registrada. En un cierre válido esto es 0. */
  readonly pendientes: number;
  /** Suma de diferencia × costo. `null` cuando NINGUNA referencia tiene costo cargado. */
  readonly valorAjuste: number | null;
  readonly valorFaltantes: number | null;
  readonly valorSobrantes: number | null;
  /** Cuántas referencias con diferencia tienen costo y cuántas no. Sin esto el total miente. */
  readonly conCosto: number;
  readonly sinCosto: number;
}

export interface KpiDeBodega extends Kpi {
  readonly bodegaId: string;
  readonly bodega: string;
  readonly fuente: 'cierre' | 'proyeccion';
  readonly cerradoEn: string | null;
  /** Contadas sin diferencia ÷ contadas. Es la "precisión" que pidió el cliente. */
  readonly precision: number | null;
}

const CERO: Kpi = {
  contadas: 0, sinDiferencia: 0, conDiferencia: 0, aclaradas: 0,
  faltantes: 0, sobrantes: 0, fantasmas: 0, sinCobertura: 0, pendientes: 0,
  valorAjuste: null, valorFaltantes: null, valorSobrantes: null, conCosto: 0, sinCosto: 0,
};

/** Fila cruda de cualquiera de las dos fuentes. Se agregan igual. */
interface FilaCruda {
  readonly bodega_id: string;
  readonly bodega: string;
  readonly contadas: number;
  readonly sin_diferencia: number;
  readonly con_diferencia: number;
  readonly aclaradas: number;
  readonly faltantes: number;
  readonly sobrantes: number;
  readonly fantasmas: number;
  readonly sin_cobertura: number;
  readonly pendientes: number;
  readonly valor_ajuste: string | null;
  readonly valor_faltantes: string | null;
  readonly valor_sobrantes: string | null;
  readonly con_costo: number;
  readonly sin_costo: number;
}

@Injectable()
export class MetricasService {
  /**
   * Los meses que existen y las bodegas que hay. Alimenta los dos filtros.
   *
   * Incluye SIEMPRE el mes en curso aunque nadie haya cerrado nada: es el que
   * la gerencia va a querer mirar, y una lista que empieza en el mes pasado
   * parece un sistema apagado.
   */
  async periodos(usuarioId: string) {
    const cierres = await conexion()<{ periodo: string; bodegas: number; ultimo: Date }[]>`
      SELECT to_char(periodo, 'YYYY-MM') AS periodo,
             count(DISTINCT bodega_id)::int AS bodegas,
             max(cerrado_en) AS ultimo
      FROM cierre_inventario
      GROUP BY periodo ORDER BY periodo DESC`;

    const [hoy] = await conexion()<{ mes: string }[]>`
      SELECT to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM') AS mes`;
    const mesActual = hoy!.mes;

    const lista = cierres.map((c) => ({
      periodo: c.periodo,
      bodegasCerradas: c.bodegas,
      ultimoCierre: c.ultimo.toISOString(),
      enCurso: c.periodo === mesActual,
    }));

    if (!lista.some((p) => p.periodo === mesActual)) {
      lista.unshift({ periodo: mesActual, bodegasCerradas: 0, ultimoCierre: '', enCurso: true });
    }

    const bodegas = await conexion()<{ id: string; nombre: string }[]>`
      SELECT b.id, b.nombre FROM bodega b
      JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}
      WHERE b.activa ORDER BY b.nombre`;

    return { periodos: lista, bodegas, mesActual };
  }

  /**
   * BLOQUE 1 · Los KPI, por bodega y en total (FR del informe comparativo).
   *
   * Una bodega con cierre del mes se lee de la foto; una sin cerrar, de la
   * proyección viva. Las dos producen exactamente las mismas columnas, así que
   * la agregación es la misma código abajo — y la diferencia queda declarada en
   * `fuente` en vez de escondida.
   */
  async resumen(periodo: Periodo, usuarioId: string) {
    const primerDia = `${periodo}-01`;

    const desdeCierre = await conexion()<(FilaCruda & { cerrado_en: Date })[]>`
      SELECT b.id AS bodega_id, b.nombre AS bodega, ci.cerrado_en,
             ${AGREGADOS()}
      FROM consolidado_historico x
      JOIN bodega b             ON b.id = x.bodega_id
      JOIN cierre_inventario ci ON ci.id = x.cierre_id
      -- Solo las bodegas ASIGNADAS. Sin esto, un agregado «de todas» le
      -- entrega a un Auditor de una sede las diferencias de las 47 restantes,
      -- por la puerta de atrás y sin necesidad de adivinar ningún UUID.
      JOIN usuario_bodega ub    ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}
      WHERE x.periodo = ${primerDia}
      GROUP BY b.id, b.nombre, ci.cerrado_en
      ORDER BY b.nombre`;

    const cerradas = new Set(desdeCierre.map((f) => f.bodega_id));

    // La proyección viva solo tiene sentido para el mes en curso. Preguntarle
    // por marzo estando en julio devolvería el estado de HOY etiquetado como
    // marzo, que es justo la confusión que este módulo existe para evitar.
    const [hoy] = await conexion()<{ mes: string }[]>`
      SELECT to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM') AS mes`;

    const desdeProyeccion =
      hoy!.mes === periodo
        ? await conexion()<FilaCruda[]>`
            -- Se parte de BODEGA, no de la proyección.
            --
            -- Con la proyección como tabla principal, una bodega donde todavía
            -- nadie ha cerrado una ronda no tiene filas y desaparece del
            -- informe. En la comparativa eso es lo peor que puede pasar: la
            -- bodega que nadie ha tocado es justo la que la gerencia necesita
            -- ver, y en su lugar salía una lista más corta sin explicación.
            -- Con el LEFT JOIN aparece con ceros, que es la verdad.
            SELECT b.id AS bodega_id, b.nombre AS bodega, ${AGREGADOS()}
            FROM bodega b
            JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}
            LEFT JOIN (
              SELECT c.bodega_id,
                     c.clasificacion,
                     c.motivo_auditable::text AS motivo,
                     c.rondas_afirmando,
                     d.codigo_razon_id,
                     CASE WHEN c.valor_final IS NOT NULL AND c.saldo_esperado_congelado IS NOT NULL
                          THEN c.valor_final - c.saldo_esperado_congelado END AS diferencia,
                     co.costo_unitario,
                     CASE WHEN co.costo_unitario IS NOT NULL
                           AND c.valor_final IS NOT NULL
                           AND c.saldo_esperado_congelado IS NOT NULL
                          THEN round((c.valor_final - c.saldo_esperado_congelado) * co.costo_unitario, 2)
                     END AS valor_ajuste,
                     NULL::uuid AS fantasma_id
              FROM articulo_consolidado c
              LEFT JOIN costo_articulo co
                     ON co.bodega_id = c.bodega_id AND co.articulo_id = c.articulo_id
              LEFT JOIN discrepancia d
                     ON d.bodega_id = c.bodega_id AND d.articulo_id = c.articulo_id
                    AND d.estado = 'cerrada'
              UNION ALL
              -- Los hallazgos no están en el consolidado: viven en su propia
              -- tabla y no tienen saldo contra el que compararse. Esa ausencia
              -- ES el hallazgo.
              SELECT pf.bodega_id, 'auditable', 'producto_fantasma', 1,
                     d.codigo_razon_id, NULL, NULL, NULL, pf.id
              FROM producto_fantasma pf
              LEFT JOIN discrepancia d ON d.fantasma_id = pf.id AND d.estado = 'cerrada'
            ) x ON x.bodega_id = b.id
            WHERE b.activa
            GROUP BY b.id, b.nombre
            ORDER BY b.nombre`
        : [];

    const bodegas: KpiDeBodega[] = [
      ...desdeCierre.map((f) => enriquecer(f, 'cierre', f.cerrado_en.toISOString())),
      ...desdeProyeccion.filter((f) => !cerradas.has(f.bodega_id)).map((f) => enriquecer(f, 'proyeccion', null)),
    ].sort((a, b) => a.bodega.localeCompare(b.bodega, 'es'));

    return { periodo, global: sumar(bodegas), bodegas };
  }

  /**
   * BLOQUE 2 · La tabla granular. Una fila por referencia.
   *
   * Paginada de verdad: hay 1.421 artículos en las ocho hojas que entregó el
   * cliente y 48 bodegas por mapear. Devolverlo entero funciona hoy y deja de
   * funcionar exactamente cuando el sistema empieza a servir para algo.
   */
  async detalle(opciones: {
    usuarioId: string;
    periodo: Periodo;
    bodegaId?: string | undefined;
    estado?: string | undefined;
    busqueda?: string | undefined;
    limite: number;
    desde: number;
  }) {
    const { usuarioId, periodo, bodegaId, estado, busqueda, limite, desde } = opciones;
    const sql = conexion();
    const primerDia = `${periodo}-01`;
    const patron = busqueda?.trim() ? `%${busqueda.trim().toLowerCase()}%` : null;

    const filas = await sql<
      {
        codigo: string | null; nombre: string; unidad: string; bodega: string;
        cantidad_final: string | null; saldo_sistema: string | null; diferencia: string | null;
        clasificacion: string; motivo: string | null; codigo_razon_id: string | null;
        origen_valor: string | null; valor_ajuste: string | null; es_fantasma: boolean;
        total: number;
      }[]
    >`
      SELECT h.codigo, h.nombre, h.unidad, b.nombre AS bodega,
             h.cantidad_final, h.saldo_sistema, h.diferencia,
             h.clasificacion, h.motivo, h.codigo_razon_id, h.origen_valor,
             h.valor_ajuste, h.fantasma_id IS NOT NULL AS es_fantasma,
             count(*) OVER ()::int AS total
      FROM consolidado_historico h
      JOIN bodega b ON b.id = h.bodega_id
      JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}
      WHERE h.periodo = ${primerDia}
        ${bodegaId ? sql`AND h.bodega_id = ${bodegaId}` : sql``}
        ${patron ? sql`AND (lower(h.nombre) LIKE ${patron} OR lower(coalesce(h.codigo,'')) LIKE ${patron})` : sql``}
        ${estado === 'faltante' ? sql`AND h.diferencia < 0` : sql``}
        ${estado === 'sobrante' ? sql`AND h.diferencia > 0` : sql``}
        ${estado === 'diferencia' ? sql`AND (h.diferencia <> 0 OR h.motivo = 'discrepancia')` : sql``}
        ${estado === 'fantasma' ? sql`AND h.fantasma_id IS NOT NULL` : sql``}
        ${estado === 'sin_cobertura' ? sql`AND h.motivo = 'sin_cobertura'` : sql``}
      ORDER BY abs(coalesce(h.diferencia, 0)) DESC, h.nombre
      LIMIT ${limite} OFFSET ${desde}`;

    return {
      total: filas[0]?.total ?? 0,
      items: filas.map((f) => ({
        codigo: f.codigo,
        nombre: f.nombre,
        unidad: f.unidad,
        bodega: f.bodega,
        cantidadFisica: f.cantidad_final,
        cantidadSistema: f.saldo_sistema,
        diferencia: f.diferencia,
        clasificacion: f.clasificacion,
        motivo: f.motivo,
        codigoRazon: f.codigo_razon_id,
        origenValor: f.origen_valor,
        valorAjuste: f.valor_ajuste === null ? null : Number(f.valor_ajuste),
        esFantasma: f.es_fantasma,
      })),
    };
  }

  /**
   * BLOQUE 3 · Doce meses de referencias con diferencia, bodega por bodega.
   *
   * Es la pregunta que de verdad importa: no "cuántas diferencias hubo" sino
   * "en qué bodegas están mejorando y en cuáles no". Por eso viaja `precision`
   * junto al conteo — una bodega con 200 diferencias sobre 2.000 referencias lo
   * está haciendo mejor que una con 50 sobre 100, y el número absoluto lo
   * escondería.
   */
  async historia(meses: number, usuarioId: string, bodegaId?: string) {
    const sql = conexion();
    const filas = await sql<
      { periodo: string; bodega_id: string; bodega: string; contadas: number; con_diferencia: number; faltantes: number; sobrantes: number; valor_ajuste: string | null }[]
    >`
      SELECT to_char(h.periodo, 'YYYY-MM') AS periodo,
             b.id AS bodega_id, b.nombre AS bodega,
             count(*) FILTER (WHERE h.rondas_afirmando >= 1 AND h.fantasma_id IS NULL)::int AS contadas,
             count(*) FILTER (WHERE h.diferencia <> 0 OR h.motivo = 'discrepancia')::int      AS con_diferencia,
             count(*) FILTER (WHERE h.diferencia < 0)::int                                    AS faltantes,
             count(*) FILTER (WHERE h.diferencia > 0)::int                                    AS sobrantes,
             sum(h.valor_ajuste)                                                              AS valor_ajuste
      FROM consolidado_historico h
      JOIN bodega b ON b.id = h.bodega_id
      JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}
      WHERE h.periodo >= date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date
                        - make_interval(months => ${meses - 1})
        ${bodegaId ? sql`AND h.bodega_id = ${bodegaId}` : sql``}
      GROUP BY 1, 2, 3
      ORDER BY 1, 3`;

    // Los meses del eje se generan completos aunque no haya datos: un hueco en
    // el eje temporal se lee como "no pasó nada", y lo que pasó es que no se
    // inventarió. Son cosas distintas y la gerencia pregunta por la segunda.
    const [rango] = await conexion()<{ meses: string[] }[]>`
      SELECT array_agg(to_char(m, 'YYYY-MM') ORDER BY m) AS meses
      FROM generate_series(
        date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date - make_interval(months => ${meses - 1}),
        date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date,
        '1 month'
      ) m`;

    const porBodega = new Map<string, { bodegaId: string; bodega: string; puntos: Map<string, (typeof filas)[number]> }>();
    for (const f of filas) {
      const entrada = porBodega.get(f.bodega_id) ?? { bodegaId: f.bodega_id, bodega: f.bodega, puntos: new Map() };
      entrada.puntos.set(f.periodo, f);
      porBodega.set(f.bodega_id, entrada);
    }

    return {
      meses: rango?.meses ?? [],
      series: [...porBodega.values()].map((s) => ({
        bodegaId: s.bodegaId,
        bodega: s.bodega,
        puntos: (rango?.meses ?? []).map((m) => {
          const p = s.puntos.get(m);
          // `null` cuando ese mes no se inventarió esa bodega: la línea se
          // corta en vez de bajar a cero, que sería mentir sobre una mejora.
          if (!p) return { periodo: m, contadas: null, conDiferencia: null, faltantes: null, sobrantes: null, precision: null, valorAjuste: null };
          return {
            periodo: m,
            contadas: p.contadas,
            conDiferencia: p.con_diferencia,
            faltantes: p.faltantes,
            sobrantes: p.sobrantes,
            precision: p.contadas > 0 ? (p.contadas - p.con_diferencia) / p.contadas : null,
            valorAjuste: p.valor_ajuste === null ? null : Number(p.valor_ajuste),
          };
        }),
      })),
    };
  }

  /**
   * BLOQUE 3 · Un producto a lo largo del tiempo.
   *
   * Se busca por CÓDIGO y no por identificador de artículo a propósito: el
   * mismo producto es una fila distinta en cada bodega —así viene el archivo
   * del cliente— y la pregunta "cómo se ha comportado el ACEITE" es sobre el
   * producto, no sobre la fila de una bodega.
   */
  async articulo(usuarioId: string, clave: { codigo?: string | undefined; nombre?: string | undefined }) {
    const sql = conexion();
    if (!clave.codigo && !clave.nombre) return { clave: null, puntos: [] };

    const filas = await sql<
      { periodo: string; bodega: string; nombre: string; unidad: string; cantidad: string | null; sistema: string | null; diferencia: string | null; valor: string | null }[]
    >`
      SELECT to_char(h.periodo, 'YYYY-MM') AS periodo, b.nombre AS bodega,
             h.nombre, h.unidad, h.cantidad_final AS cantidad,
             h.saldo_sistema AS sistema, h.diferencia, h.valor_ajuste AS valor
      FROM consolidado_historico h
      JOIN bodega b ON b.id = h.bodega_id
      JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}
      WHERE ${clave.codigo ? sql`h.codigo = ${clave.codigo}` : sql`lower(h.nombre) = ${clave.nombre!.toLowerCase()}`}
      ORDER BY h.periodo, b.nombre`;

    return {
      clave: clave.codigo ?? clave.nombre ?? null,
      nombre: filas[0]?.nombre ?? null,
      unidad: filas[0]?.unidad ?? null,
      puntos: filas.map((f) => ({
        periodo: f.periodo,
        bodega: f.bodega,
        cantidadFisica: f.cantidad,
        cantidadSistema: f.sistema,
        diferencia: f.diferencia,
        valorAjuste: f.valor === null ? null : Number(f.valor),
      })),
    };
  }

  /** Las causas con las que el Auditor cerró, y cuánto pesa cada una. */
  async porCausa(periodo: Periodo, usuarioId: string, bodegaId?: string) {
    const sql = conexion();
    const filas = await sql<{ causa: string; descripcion: string; referencias: number; valor: string | null }[]>`
      SELECT h.codigo_razon_id AS causa, cr.descripcion,
             count(*)::int AS referencias, sum(h.valor_ajuste) AS valor
      FROM consolidado_historico h
      JOIN codigo_razon cr ON cr.id = h.codigo_razon_id
      JOIN usuario_bodega ub ON ub.bodega_id = h.bodega_id AND ub.usuario_id = ${usuarioId}
      WHERE h.periodo = ${`${periodo}-01`}
        ${bodegaId ? sql`AND h.bodega_id = ${bodegaId}` : sql``}
      GROUP BY 1, 2 ORDER BY 3 DESC`;

    return filas.map((f) => ({
      causa: f.causa,
      descripcion: f.descripcion,
      referencias: f.referencias,
      valorAjuste: f.valor === null ? null : Number(f.valor),
    }));
  }
}

/**
 * Los agregados, escritos UNA vez.
 *
 * Las dos fuentes —la foto del cierre y la proyección viva— exponen las mismas
 * columnas, así que la definición de "faltante" o de "aclarada" vive en un solo
 * sitio. Duplicarla garantizaría que algún día las dos pantallas del mismo mes
 * mostraran cifras distintas y nadie supiera cuál creer.
 *
 * Las definiciones, explícitas:
 *   · contadas      — alguna ronda la afirmó. Los hallazgos no cuentan aquí:
 *                     no son referencias del catálogo.
 *   · sinDiferencia — cuadró y nunca levantó bandera.
 *   · conDiferencia — el conteo no cuadró con el ERP en su momento.
 *   · aclaradas     — tenía diferencia y tras el Auditor ya no la tiene: era un
 *                     error de conteo, de unidad o de parametrización.
 *   · faltantes     — tras el Auditor sigue habiendo MENOS. Es la merma real.
 *   · sobrantes     — sigue habiendo MÁS.
 *
 * `aclaradas`, `faltantes` y `sobrantes` SÍ son disjuntas entre sí: parten
 * `conDiferencia` por el signo de la diferencia final (0, negativa, positiva).
 * Lo que falta para cuadrar la suma son las que no tienen diferencia calculable
 * —falta uno de los dos números—, no las pendientes.
 *
 * ⚠️ `pendientes` NO pertenece a esa partición: es una marca transversal («con
 * diferencia y sin causa registrada») que se solapa con faltantes y sobrantes.
 * El comentario anterior decía que sumaba con ellas, y quien apilara los cinco
 * tramos en una barra obtendría un total mayor que el real. Sirve para avisar,
 * no para repartir.
 */
function AGREGADOS() {
  // Alias fijo `x`: las dos fuentes se exponen con el mismo nombre para que
  // esta definición sea literalmente la misma cadena en ambos casos. Un alias
  // parametrizado obligaría a interpolar identificadores a mano, que es la
  // puerta por la que entra el SQL construido con `+`.
  return conexion()`
    count(*) FILTER (WHERE x.rondas_afirmando >= 1 AND x.fantasma_id IS NULL)::int AS contadas,
    count(*) FILTER (WHERE x.rondas_afirmando >= 1 AND x.fantasma_id IS NULL
                       AND x.diferencia = 0 AND x.motivo IS DISTINCT FROM 'discrepancia')::int AS sin_diferencia,
    count(*) FILTER (WHERE x.fantasma_id IS NULL
                       AND (x.diferencia <> 0 OR x.motivo = 'discrepancia'))::int AS con_diferencia,
    count(*) FILTER (WHERE x.fantasma_id IS NULL AND x.motivo = 'discrepancia'
                       AND x.diferencia = 0 AND x.codigo_razon_id IS NOT NULL)::int AS aclaradas,
    count(*) FILTER (WHERE x.diferencia < 0)::int AS faltantes,
    count(*) FILTER (WHERE x.diferencia > 0)::int AS sobrantes,
    count(*) FILTER (WHERE x.fantasma_id IS NOT NULL)::int AS fantasmas,
    count(*) FILTER (WHERE x.motivo = 'sin_cobertura')::int AS sin_cobertura,
    count(*) FILTER (WHERE (x.diferencia <> 0 OR x.motivo = 'discrepancia')
                       AND x.codigo_razon_id IS NULL)::int AS pendientes,
    sum(x.valor_ajuste)                                      AS valor_ajuste,
    sum(x.valor_ajuste) FILTER (WHERE x.valor_ajuste < 0)    AS valor_faltantes,
    sum(x.valor_ajuste) FILTER (WHERE x.valor_ajuste > 0)    AS valor_sobrantes,
    count(*) FILTER (WHERE x.diferencia <> 0 AND x.costo_unitario IS NOT NULL)::int AS con_costo,
    count(*) FILTER (WHERE x.diferencia <> 0 AND x.costo_unitario IS NULL)::int     AS sin_costo`;
}

function enriquecer(f: FilaCruda, fuente: 'cierre' | 'proyeccion', cerradoEn: string | null): KpiDeBodega {
  return {
    bodegaId: f.bodega_id,
    bodega: f.bodega,
    fuente,
    cerradoEn,
    contadas: f.contadas,
    sinDiferencia: f.sin_diferencia,
    conDiferencia: f.con_diferencia,
    aclaradas: f.aclaradas,
    faltantes: f.faltantes,
    sobrantes: f.sobrantes,
    fantasmas: f.fantasmas,
    sinCobertura: f.sin_cobertura,
    pendientes: f.pendientes,
    valorAjuste: f.valor_ajuste === null ? null : Number(f.valor_ajuste),
    valorFaltantes: f.valor_faltantes === null ? null : Number(f.valor_faltantes),
    valorSobrantes: f.valor_sobrantes === null ? null : Number(f.valor_sobrantes),
    conCosto: f.con_costo,
    sinCosto: f.sin_costo,
    precision: f.contadas > 0 ? (f.contadas - f.con_diferencia) / f.contadas : null,
  };
}

/**
 * El total global.
 *
 * `valorAjuste` sigue siendo `null` si NINGUNA bodega tiene costo cargado. Un 0
 * ahí se leería como "el mes cerró sin impacto contable", que es exactamente lo
 * contrario de lo que ocurre: no se sabe cuánto fue.
 */
function sumar(bodegas: readonly KpiDeBodega[]): Kpi & { precision: number | null; bodegas: number } {
  const total = bodegas.reduce<Kpi>((a, b) => ({
    contadas: a.contadas + b.contadas,
    sinDiferencia: a.sinDiferencia + b.sinDiferencia,
    conDiferencia: a.conDiferencia + b.conDiferencia,
    aclaradas: a.aclaradas + b.aclaradas,
    faltantes: a.faltantes + b.faltantes,
    sobrantes: a.sobrantes + b.sobrantes,
    fantasmas: a.fantasmas + b.fantasmas,
    sinCobertura: a.sinCobertura + b.sinCobertura,
    pendientes: a.pendientes + b.pendientes,
    valorAjuste: suma(a.valorAjuste, b.valorAjuste),
    valorFaltantes: suma(a.valorFaltantes, b.valorFaltantes),
    valorSobrantes: suma(a.valorSobrantes, b.valorSobrantes),
    conCosto: a.conCosto + b.conCosto,
    sinCosto: a.sinCosto + b.sinCosto,
  }), CERO);

  return {
    ...total,
    bodegas: bodegas.length,
    precision: total.contadas > 0 ? (total.contadas - total.conDiferencia) / total.contadas : null,
  };
}

function suma(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
