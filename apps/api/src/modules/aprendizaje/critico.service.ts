import { Injectable } from '@nestjs/common';
import type { Evento, TipoEvento } from '@cci/contracts';
import type postgres from 'postgres';

import { conexion } from '../../platform/db/cliente';
import type { Consumidor } from '../../platform/eventos/bus';

/**
 * El crítico: qué tan bien hizo su trabajo **el sistema** en cada ronda.
 *
 * ⚠️ **Evalúa a la máquina, no a la persona.** Es la decisión que define este
 * archivo entero.
 *
 * Un informe que califica operarios —"corrigió 4 de 20"— se usa contra ellos
 * tarde o temprano, y una herramienta que se usa contra quien la opera se
 * abandona. Con ella se pierde el inventario, que es lo único que de verdad
 * importa aquí. Así que lo que se mide es dónde falló la máquina: qué no
 * entendió la gramática, qué obligó a desambiguar, qué hubo que corregir. Los
 * hallazgos hablan del sistema y ninguno nombra a nadie.
 *
 * Corre como consumidor de `RondaCerrada`: una crítica por ronda, no por
 * conteo. En el pico son 35 conteos por segundo y 350 bodegas; analizar cada
 * turno costaría más que el sistema entero y no diría nada que el agregado no
 * diga mejor.
 */
@Injectable()
export class CriticoService implements Consumidor {
  readonly nombre = 'critico';
  readonly interesadoEn: readonly TipoEvento[] = ['RondaCerrada'];

  async manejar(trx: postgres.TransactionSql, evento: Evento): Promise<void> {
    const { rondaId, bodegaId } = evento.payload as { rondaId: string; bodegaId: string };

    const [m] = await trx<
      {
        registros: number; correcciones: number; sin_gramatica: number;
        desambiguadas: number; discrepantes: number; sin_verificacion: number;
      }[]
    >`
      SELECT count(*)::int AS registros,
             count(*) FILTER (WHERE secuencia > 1)::int AS correcciones,
             count(*) FILTER (WHERE origen_parse <> 'gramatica' AND texto_dictado IS NOT NULL)::int AS sin_gramatica,
             count(*) FILTER (WHERE origen_nombre = 'seleccion_usuario')::int AS desambiguadas,
             count(*) FILTER (WHERE resolucion_discrepante)::int AS discrepantes,
             count(*) FILTER (WHERE resultado_validacion = 'sin_verificacion')::int AS sin_verificacion
      FROM registro_conteo WHERE ronda_id = ${rondaId} AND estado = 'contado'`;

    const metricas = {
      registros: m?.registros ?? 0,
      correcciones: m?.correcciones ?? 0,
      sinGramatica: m?.sin_gramatica ?? 0,
      desambiguadas: m?.desambiguadas ?? 0,
      discrepantes: m?.discrepantes ?? 0,
      sinVerificacion: m?.sin_verificacion ?? 0,
    };

    const hallazgos = diagnosticar(metricas);

    // Se guarda en la MISMA transacción que marca el evento como despachado:
    // o hay crítica y evento procesado, o no hay ninguno de los dos.
    await trx`
      INSERT INTO critica_ronda
        (ronda_id, bodega_id, registros, correcciones, sin_gramatica,
         desambiguadas, discrepantes, hallazgos, relato, critico)
      VALUES (${rondaId}, ${bodegaId}, ${metricas.registros}, ${metricas.correcciones},
              ${metricas.sinGramatica}, ${metricas.desambiguadas}, ${metricas.discrepantes},
              ${trx.json(hallazgos as unknown as postgres.JSONValue)}, ${relatar(metricas, hallazgos)}, 'determinista')
      ON CONFLICT (ronda_id) DO NOTHING`;
  }

  /** Las críticas de una bodega, para el panel. */
  async criticas(bodegaId: string) {
    const filas = await conexion()<
      {
        ronda_id: string; registros: number; correcciones: number; sin_gramatica: number;
        desambiguadas: number; discrepantes: number; hallazgos: unknown; relato: string | null;
        creada_en: Date; operador: string;
      }[]
    >`
      SELECT c.ronda_id, c.registros, c.correcciones, c.sin_gramatica, c.desambiguadas,
             c.discrepantes, c.hallazgos, c.relato, c.creada_en, u.nombre AS operador
      FROM critica_ronda c
      JOIN ronda r   ON r.id = c.ronda_id
      JOIN usuario u ON u.id = r.operador_id
      WHERE c.bodega_id = ${bodegaId}
      ORDER BY c.creada_en DESC LIMIT 50`;

    return filas.map((f) => ({
      rondaId: f.ronda_id,
      // El operador se nombra para poder volver al libro, no para calificarlo:
      // ningún hallazgo se refiere a él.
      operador: f.operador,
      creadaEn: f.creada_en.toISOString(),
      metricas: {
        registros: f.registros,
        correcciones: f.correcciones,
        sinGramatica: f.sin_gramatica,
        desambiguadas: f.desambiguadas,
        discrepantes: f.discrepantes,
      },
      hallazgos: f.hallazgos,
      relato: f.relato,
    }));
  }
}

interface Metricas {
  readonly registros: number;
  readonly correcciones: number;
  readonly sinGramatica: number;
  readonly desambiguadas: number;
  readonly discrepantes: number;
  readonly sinVerificacion: number;
}

export interface Hallazgo {
  readonly punto: string;
  readonly detalle: string;
  readonly comoSeArregla: string;
}

/**
 * Los umbrales del diagnóstico.
 *
 * Están arriba y con nombre porque son discutibles: son el criterio de qué
 * merece señalarse. Un crítico que señala todo no se lee.
 */
const UMBRAL_CORRECCION = 0.15;
const UMBRAL_GRAMATICA = 0.2;
const UMBRAL_DESAMBIGUACION = 0.1;

/**
 * De las métricas a puntos flojos, con **qué** y **cómo** se arregla cada uno.
 *
 * Determinista: no hace falta un modelo para saber que una gramática que falla
 * el 30% de las veces necesita más patrones. El valor de decirlo está en el
 * "cómo", y el cómo es siempre el mismo para cada síntoma.
 */
export function diagnosticar(m: Metricas): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  if (m.registros === 0) return hallazgos;

  const tasa = (n: number) => n / m.registros;

  if (tasa(m.sinGramatica) > UMBRAL_GRAMATICA) {
    hallazgos.push({
      punto: 'La gramática se quedó corta',
      detalle: `${m.sinGramatica} de ${m.registros} dictados no los resolvió la gramática y hubo que ir al modelo o al teclado.`,
      comoSeArregla:
        'Los textos concretos están en el reporte como propuestas de gramática. ' +
        'Convertirlos en casos de prueba y ampliar los patrones: el arreglo es permanente y no cuesta por llamada.',
    });
  }

  if (tasa(m.desambiguadas) > UMBRAL_DESAMBIGUACION) {
    hallazgos.push({
      punto: 'El catálogo obliga a elegir a mano demasiado seguido',
      detalle: `${m.desambiguadas} de ${m.registros} conteos exigieron que el operario escogiera de una lista.`,
      comoSeArregla:
        'Aprobar los alias que el reporte propone. Cada uno codifica lo que varias personas ya decidieron, ' +
        'y a partir de ahí el nombre resuelve solo.',
    });
  }

  if (tasa(m.correcciones) > UMBRAL_CORRECCION) {
    hallazgos.push({
      punto: 'Hubo que corregir más de lo normal',
      detalle: `${m.correcciones} de ${m.registros} conteos se corrigieron dentro de la ronda.`,
      comoSeArregla:
        'Revisar en el reporte si las correcciones son confusiones de dígitos que se repiten. ' +
        'Si lo son, la salida es pedir confirmación explícita para esas cifras, no cambiar el umbral de alerta.',
    });
  }

  if (m.discrepantes > 0) {
    hallazgos.push({
      punto: 'El dispositivo y el servidor no coincidieron al resolver un nombre',
      detalle: `${m.discrepantes} conteos quedaron marcados porque el catálogo cacheado del dispositivo dio otro artículo.`,
      comoSeArregla:
        'Suele significar que el dispositivo lleva un catálogo viejo. Forzar la recarga del catálogo al abrir la ronda; ' +
        'los artículos afectados ya están en la bandeja del Auditor.',
    });
  }

  if (m.sinVerificacion > 0) {
    hallazgos.push({
      punto: 'Algún artículo agotó sus verificaciones',
      detalle: `${m.sinVerificacion} conteos llegaron al límite de intentos y el sistema dejó de validarlos.`,
      comoSeArregla:
        'Es el comportamiento correcto —impide usar la alerta para adivinar el saldo— pero tres intentos seguidos ' +
        'en el mismo artículo suelen indicar que la unidad del catálogo no corresponde a cómo se almacena.',
    });
  }

  if (hallazgos.length === 0) {
    hallazgos.push({
      punto: 'Sin puntos flojos',
      detalle: `La ronda se capturó limpia: ${m.registros} conteos sin correcciones ni desambiguaciones fuera de lo normal.`,
      comoSeArregla: 'Nada que hacer.',
    });
  }

  return hallazgos;
}

function relatar(m: Metricas, hallazgos: readonly Hallazgo[]): string {
  if (m.registros === 0) return 'La ronda se cerró sin conteos afirmados.';

  const base = `${m.registros} conteos. La gramática resolvió ${m.registros - m.sinGramatica}, ` +
    `se corrigieron ${m.correcciones} y se desambiguaron ${m.desambiguadas} a mano.`;

  return hallazgos[0]?.punto === 'Sin puntos flojos'
    ? `${base} Sin puntos flojos.`
    : `${base} ${hallazgos.length} puntos que revisar: ${hallazgos.map((h) => h.punto.toLowerCase()).join('; ')}.`;
}
