import { Injectable } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';

/**
 * El AUTO-PULIDO: el sistema se examina a sí mismo, una vez al mes.
 *
 * ⚠️ **Evalúa a la máquina, NUNCA a la persona.** Es la misma decisión que
 * fijó `critica_ronda` en la migración 0015 y aquí se hereda entera: un informe
 * que califica operarios se acaba usando contra ellos, y una herramienta que se
 * usa contra quien la opera se abandona. Con ella se pierde el inventario. Así
 * que lo que se mide es dónde falló la gramática, qué obligó a desambiguar y
 * qué hubo que corregir — no quién se equivocó.
 *
 * Los datos son REALES cuando existen: `critica_ronda` se escribe al cerrar
 * cada ronda y `propuesta_mejora` guarda lo que el sistema propone cambiar,
 * con su estado y quién lo decidió. Lo que todavía no puede ser real es la
 * serie de doce meses: el sistema lleva semanas en pie, no un año. Esa parte
 * viaja marcada `simulado: true` y la pantalla lo dice en voz alta, porque un
 * gráfico de tendencia inventado y sin etiqueta es una mentira con ejes.
 */

export interface Autopulido {
  readonly periodo: string;
  readonly simulado: boolean;
  readonly rondasAnalizadas: number;
  readonly registros: number;
  readonly indice: {
    /** De cada 100 dictados, cuántos entendió la gramática a la primera. */
    readonly aciertoGramatica: number | null;
    /** Cuántos obligaron a preguntar "¿cuál de estos?". */
    readonly desambiguacion: number | null;
    /** Cuántos hubo que corregir después de registrarlos. */
    readonly correccion: number | null;
  };
  readonly tendencia: readonly { periodo: string; aciertoGramatica: number; desambiguacion: number; correccion: number }[];
  readonly hallazgos: readonly { titulo: string; veces: number; bodega: string | null }[];
  readonly propuestas: readonly {
    id: string; tipo: string; accion: string; evidencia: string;
    veces: number; estado: string; aplicable: boolean;
  }[];
}

@Injectable()
export class AutopulidoService {
  async informe(periodo: string): Promise<Autopulido> {
    const primerDia = `${periodo}-01`;

    const [agregado] = await conexion()<
      { rondas: number; registros: number; correcciones: number; sin_gramatica: number; desambiguadas: number }[]
    >`
      SELECT count(*)::int AS rondas,
             coalesce(sum(registros), 0)::int      AS registros,
             coalesce(sum(correcciones), 0)::int   AS correcciones,
             coalesce(sum(sin_gramatica), 0)::int  AS sin_gramatica,
             coalesce(sum(desambiguadas), 0)::int  AS desambiguadas
      FROM critica_ronda
      WHERE date_trunc('month', creada_en AT TIME ZONE 'America/Bogota')::date = ${primerDia}`;

    const registros = agregado?.registros ?? 0;
    const real = (agregado?.rondas ?? 0) > 0 && registros > 0;

    const hallazgos = await conexion()<{ titulo: string; veces: number; bodega: string | null }[]>`
      SELECT h ->> 'titulo' AS titulo, count(*)::int AS veces, max(b.nombre) AS bodega
      FROM critica_ronda c
      JOIN bodega b ON b.id = c.bodega_id
      CROSS JOIN LATERAL jsonb_array_elements(c.hallazgos) h
      WHERE date_trunc('month', c.creada_en AT TIME ZONE 'America/Bogota')::date = ${primerDia}
        AND h ? 'titulo'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;

    // Las propuestas NO se filtran por mes: una propuesta viva sigue viva en
    // marzo aunque se detectara en enero, y ocultarla al cambiar de filtro
    // sería exactamente el panel que insiste con lo ya decidido y que la
    // migración 0015 existe para evitar — al revés.
    const propuestas = await conexion()<
      { id: string; tipo: string; accion: string; evidencia: string; veces: number; estado: string; aplicable: boolean }[]
    >`
      SELECT id, tipo, accion, evidencia, veces, estado::text AS estado,
             aplicable IS NOT NULL AS aplicable
      FROM propuesta_mejora
      WHERE estado <> 'rechazada'
      ORDER BY veces DESC, detectada_en DESC LIMIT 10`;

    return {
      periodo,
      simulado: !real,
      rondasAnalizadas: agregado?.rondas ?? 0,
      registros,
      indice: real
        ? {
            aciertoGramatica: pct(registros - (agregado?.sin_gramatica ?? 0), registros),
            desambiguacion: pct(agregado?.desambiguadas ?? 0, registros),
            correccion: pct(agregado?.correcciones ?? 0, registros),
          }
        : DEMO.indice,
      tendencia: real ? await this.tendencia(periodo) : DEMO.tendencia,
      hallazgos: hallazgos.length > 0 ? hallazgos : real ? [] : DEMO.hallazgos,
      propuestas,
    };
  }

  /** Doce meses de crítica, agrupados por mes. Vacío hasta que haya historia. */
  private async tendencia(hasta: string) {
    const filas = await conexion()<
      { periodo: string; registros: number; sin_gramatica: number; desambiguadas: number; correcciones: number }[]
    >`
      SELECT to_char(date_trunc('month', creada_en AT TIME ZONE 'America/Bogota'), 'YYYY-MM') AS periodo,
             sum(registros)::int AS registros, sum(sin_gramatica)::int AS sin_gramatica,
             sum(desambiguadas)::int AS desambiguadas, sum(correcciones)::int AS correcciones
      FROM critica_ronda
      WHERE creada_en >= (${`${hasta}-01`}::date - interval '11 months')
      GROUP BY 1 ORDER BY 1`;

    return filas
      .filter((f) => f.registros > 0)
      .map((f) => ({
        periodo: f.periodo,
        aciertoGramatica: pct(f.registros - f.sin_gramatica, f.registros) ?? 0,
        desambiguacion: pct(f.desambiguadas, f.registros) ?? 0,
        correccion: pct(f.correcciones, f.registros) ?? 0,
      }));
  }
}

function pct(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((parte / total) * 1000) / 10;
}

/**
 * El ejemplo que ocupa el sitio mientras no hay historia.
 *
 * Está aquí y no en el frontend a propósito: si el día que lleguen los datos
 * reales alguien se olvida de quitar el relleno, el `simulado: true` viaja en
 * la misma respuesta que los números y la pantalla no puede pintarlos sin
 * decirlo. Un dato de mentira en el cliente no lleva esa etiqueta pegada.
 *
 * Las cifras describen una curva de aprendizaje plausible —la gramática mejora
 * cuando se le añaden alias, la desambiguación baja después— y no pretenden
 * predecir nada.
 */
const DEMO = {
  indice: { aciertoGramatica: 91.4, desambiguacion: 6.2, correccion: 3.1 },
  tendencia: [
    { periodo: '2025-08', aciertoGramatica: 71.2, desambiguacion: 18.4, correccion: 9.8 },
    { periodo: '2025-09', aciertoGramatica: 74.8, desambiguacion: 16.9, correccion: 8.6 },
    { periodo: '2025-10', aciertoGramatica: 78.1, desambiguacion: 15.2, correccion: 7.9 },
    { periodo: '2025-11', aciertoGramatica: 80.6, desambiguacion: 13.7, correccion: 7.1 },
    { periodo: '2025-12', aciertoGramatica: 82.3, desambiguacion: 12.4, correccion: 6.4 },
    { periodo: '2026-01', aciertoGramatica: 84.0, desambiguacion: 11.1, correccion: 5.8 },
    { periodo: '2026-02', aciertoGramatica: 85.9, desambiguacion: 10.2, correccion: 5.2 },
    { periodo: '2026-03', aciertoGramatica: 87.1, desambiguacion: 9.3, correccion: 4.7 },
    { periodo: '2026-04', aciertoGramatica: 88.4, desambiguacion: 8.5, correccion: 4.2 },
    { periodo: '2026-05', aciertoGramatica: 89.6, desambiguacion: 7.6, correccion: 3.8 },
    { periodo: '2026-06', aciertoGramatica: 90.5, desambiguacion: 6.9, correccion: 3.4 },
    { periodo: '2026-07', aciertoGramatica: 91.4, desambiguacion: 6.2, correccion: 3.1 },
  ],
  hallazgos: [
    { titulo: 'La gramática no reconoce «bulto» como empaque', veces: 34, bodega: 'STOCK ALMACEN AYB' },
    { titulo: 'Dos artículos compiten por el mismo dictado: «aceite»', veces: 27, bodega: 'STOCK RESTAURANTE FUENTES AYB' },
    { titulo: 'Cantidades en fracción verbal («media caja») sin regla', veces: 19, bodega: 'ZOOLOGICO' },
    { titulo: 'El nombre del catálogo lleva la unidad dentro («X100»)', veces: 15, bodega: 'STOCK ALMACEN  SUMINISTROS' },
  ],
} as const;
