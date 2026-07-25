import type { Etapa } from '../telemetria';

/**
 * F-32 · Presupuesto de latencia POR ETAPA (D-23, Principio VII).
 *
 * "Debe sentirse en tiempo real" no es verificable. Un número con percentil sí
 * — y un número agregado dice que algo se puso lento, no *qué*. Con 1.500 ms
 * repartidos entre siete etapas, sin atribución no hay diagnóstico.
 *
 * Estos umbrales **fallan la build**, no generan un ticket.
 */

export const PRESUPUESTO_MS: Readonly<Record<Etapa, number>> = {
  fin_de_turno: 400,
  transcripcion: 300,
  gramatica: 15,
  resolucion_nombre: 20,
  escritura_local: 30,
  readback: 250,
  envio: 200,
  validacion_servidor: 200,
};

/**
 * Lo que el operario percibe termina cuando el dato es durable EN EL
 * DISPOSITIVO — la red viene después (D-15). Por eso el envío y la validación
 * del servidor no entran en el ciclo percibido: si entraran, el número
 * dependería de la calidad del Wi-Fi de la bodega.
 */
export const ETAPAS_PERCIBIDAS: readonly Etapa[] = [
  'fin_de_turno',
  'transcripcion',
  'gramatica',
  'resolucion_nombre',
  'escritura_local',
  'readback',
];

/** SC-1.2: el 95% de los registros confirma en menos de 1,5 s. */
export const CICLO_PERCIBIDO_MS = 1500;

export interface Medicion {
  readonly etapa: Etapa;
  readonly p95: number;
}

export interface Veredicto {
  readonly dentroDePresupuesto: boolean;
  readonly cicloPercibidoP95: number;
  readonly excedidas: readonly { etapa: Etapa; p95: number; presupuesto: number }[];
}

/**
 * Evalúa una tanda de mediciones contra el presupuesto.
 *
 * Comprueba las dos cosas por separado a propósito: una etapa puede caber en
 * su presupuesto y aun así el ciclo entero pasarse, si varias van justas. Y al
 * revés — una etapa desbordada se ve aunque el total todavía quepa, que es
 * cuando conviene enterarse.
 */
export function evaluar(mediciones: readonly Medicion[]): Veredicto {
  const excedidas = mediciones
    .filter((m) => m.p95 > PRESUPUESTO_MS[m.etapa])
    .map((m) => ({ etapa: m.etapa, p95: m.p95, presupuesto: PRESUPUESTO_MS[m.etapa] }));

  const cicloPercibidoP95 = mediciones
    .filter((m) => ETAPAS_PERCIBIDAS.includes(m.etapa))
    .reduce((suma, m) => suma + m.p95, 0);

  return {
    dentroDePresupuesto: excedidas.length === 0 && cicloPercibidoP95 <= CICLO_PERCIBIDO_MS,
    cicloPercibidoP95,
    excedidas,
  };
}

/** La suma de los presupuestos percibidos debe caber en el ciclo. */
export function presupuestoPercibidoTotal(): number {
  return ETAPAS_PERCIBIDAS.reduce((s, e) => s + PRESUPUESTO_MS[e], 0);
}
