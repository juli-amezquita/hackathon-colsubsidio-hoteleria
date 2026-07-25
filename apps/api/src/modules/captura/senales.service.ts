import { Injectable } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';
import type {
  ProveedorDeSenalesDeCaptura,
  SenalesDeCaptura,
  Ventana,
} from '../../platform/dominio/senales';

/**
 * Las señales que produce el dominio `captura`.
 *
 * Vive aquí y no en el módulo de reportes porque es `captura` quien sabe leer
 * sus propias tablas. El módulo de aprendizaje recibe la señal ya interpretada
 * y no conoce ni una columna de este dominio (Principio III).
 *
 * ⚠️ Ninguna consulta de este archivo lee `saldo_esperado`. Un reporte de
 * calidad de captura no necesita el saldo, y no pedirlo es lo que garantiza
 * que no pueda filtrarse por aquí.
 */
@Injectable()
export class SenalesCapturaService implements ProveedorDeSenalesDeCaptura {
  async senalesDeCaptura(v: Ventana): Promise<SenalesDeCaptura> {
    const bodega = v.bodegaId ?? null;

    const [totales] = await conexion()<
      { registros: number; correcciones: number; discrepantes: number }[]
    >`
      SELECT count(*)::int AS registros,
             -- Una corrección es un registro con secuencia > 1: alguien volvió
             -- sobre el mismo artículo en la misma ronda (D4).
             count(*) FILTER (WHERE r.secuencia > 1)::int AS correcciones,
             count(*) FILTER (WHERE r.resolucion_discrepante)::int AS discrepantes
      FROM registro_conteo r
      JOIN ronda ro ON ro.id = r.ronda_id
      WHERE r.recibido_en >= ${v.desde} AND r.recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR ro.bodega_id = ${bodega})`;

    const porParse = await conexion()<{ clave: string; n: number }[]>`
      SELECT r.origen_parse::text AS clave, count(*)::int n
      FROM registro_conteo r JOIN ronda ro ON ro.id = r.ronda_id
      WHERE r.recibido_en >= ${v.desde} AND r.recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR ro.bodega_id = ${bodega})
      GROUP BY 1`;

    const porNombre = await conexion()<{ clave: string; n: number }[]>`
      SELECT r.origen_nombre::text AS clave, count(*)::int n
      FROM registro_conteo r JOIN ronda ro ON ro.id = r.ronda_id
      WHERE r.origen_nombre IS NOT NULL
        AND r.recibido_en >= ${v.desde} AND r.recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR ro.bodega_id = ${bodega})
      GROUP BY 1`;

    // Los textos que la gramática determinista NO supo resolver. Cada uno es un
    // caso de prueba que le falta, y la gramática es código con tests: esto se
    // pule en horas, no reentrenando nada.
    const sinResolver = await conexion()<{ texto: string; veces: number; origen: string }[]>`
      SELECT r.texto_dictado AS texto, count(*)::int veces, r.origen_parse::text AS origen
      FROM registro_conteo r JOIN ronda ro ON ro.id = r.ronda_id
      WHERE r.texto_dictado IS NOT NULL AND r.origen_parse <> 'gramatica'
        AND r.recibido_en >= ${v.desde} AND r.recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR ro.bodega_id = ${bodega})
      GROUP BY 1, 3 ORDER BY 2 DESC LIMIT 50`;

    // Lo que el operario tuvo que elegir a mano de la lista de candidatos. Es
    // la señal más accionable que existe: cada repetición dice "cuando alguien
    // diga ESTO, quiere decir ESE artículo" — y eso es exactamente un alias.
    const desambiguaciones = await conexion()<
      { texto: string; articulo_id: string; articulo: string; bodega_id: string; veces: number }[]
    >`
      SELECT r.texto_dictado AS texto, r.articulo_id, a.nombre AS articulo,
             ro.bodega_id, count(*)::int veces
      FROM registro_conteo r
      JOIN ronda ro    ON ro.id = r.ronda_id
      JOIN articulo a  ON a.id = r.articulo_id
      WHERE r.origen_nombre = 'seleccion_usuario' AND r.texto_dictado IS NOT NULL
        AND r.recibido_en >= ${v.desde} AND r.recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR ro.bodega_id = ${bodega})
      GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 50`;

    // Qué cantidad se guardó primero y cuál quedó. Con el texto dictado al
    // lado, es lo que permite ver si una confusión es acústica y se repite.
    const numericas = await conexion()<
      { texto: string | null; antes: string; despues: string; articulo: string }[]
    >`
      WITH ordenados AS (
        SELECT r.ronda_id, r.articulo_id, r.secuencia, r.cantidad, r.texto_dictado,
               lead(r.cantidad) OVER (PARTITION BY r.ronda_id, r.articulo_id ORDER BY r.secuencia) AS siguiente
        FROM registro_conteo r
        JOIN ronda ro ON ro.id = r.ronda_id
        WHERE r.estado = 'contado'
          AND r.recibido_en >= ${v.desde} AND r.recibido_en < ${v.hasta}
          AND (${bodega}::uuid IS NULL OR ro.bodega_id = ${bodega})
      )
      SELECT o.texto_dictado AS texto, o.cantidad AS antes, o.siguiente AS despues, a.nombre AS articulo
      FROM ordenados o JOIN articulo a ON a.id = o.articulo_id
      WHERE o.siguiente IS NOT NULL AND o.siguiente <> o.cantidad
      LIMIT 200`;

    const [fantasmas] = await conexion()<{ n: number }[]>`
      SELECT count(*)::int n FROM producto_fantasma pf
      WHERE jsonb_array_length(pf.candidatos_catalogo) > 0
        AND pf.recibido_en >= ${v.desde} AND pf.recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR pf.bodega_id = ${bodega})`;

    return {
      registros: totales?.registros ?? 0,
      correcciones: totales?.correcciones ?? 0,
      resolucionesDiscrepantes: totales?.discrepantes ?? 0,
      porOrigenParse: Object.fromEntries(porParse.map((f) => [f.clave, f.n])),
      porOrigenNombre: Object.fromEntries(porNombre.map((f) => [f.clave, f.n])),
      textosSinResolver: sinResolver.map((f) => ({
        texto: f.texto, veces: f.veces, origenParse: f.origen,
      })),
      desambiguaciones: desambiguaciones.map((f) => ({
        texto: f.texto, articuloId: f.articulo_id, articulo: f.articulo,
        bodegaId: f.bodega_id, veces: f.veces,
      })),
      correccionesNumericas: numericas.map((f) => ({
        texto: f.texto, antes: f.antes, despues: f.despues, articulo: f.articulo,
      })),
      fantasmasConCandidatosDescartados: fantasmas?.n ?? 0,
    };
  }
}
