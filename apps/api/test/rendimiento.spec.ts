import { describe, expect, it } from 'vitest';

import {
  CICLO_PERCIBIDO_MS,
  ETAPAS_PERCIBIDAS,
  PRESUPUESTO_MS,
  evaluar,
  presupuestoPercibidoTotal,
} from '../src/platform/telemetria/presupuesto';
import { ETAPAS } from '../src/platform/telemetria';

/**
 * F-32 · El presupuesto de latencia es un test, no una aspiración.
 *
 * Estas comprobaciones son de coherencia: verifican que el presupuesto que
 * escribimos en el plan sea internamente consistente. Las mediciones reales
 * las produce k6 (F-33); esto impide que alguien suba un umbral por comodidad
 * hasta que dejen de sumar.
 */
describe('F-32 · presupuesto por etapa', () => {
  it('toda etapa instrumentada tiene presupuesto', () => {
    // Sin esto, añadir una etapa nueva la dejaría sin techo y nadie lo notaría.
    for (const etapa of ETAPAS) {
      expect(PRESUPUESTO_MS[etapa], `Falta el presupuesto de ${etapa}`).toBeGreaterThan(0);
    }
  });

  it('las etapas percibidas suman menos que el ciclo completo', () => {
    // Si esta falla, el presupuesto es aritméticamente imposible de cumplir.
    const total = presupuestoPercibidoTotal();
    expect(total).toBeLessThanOrEqual(CICLO_PERCIBIDO_MS);
  });

  it('el envío y la validación NO entran en el ciclo percibido', () => {
    // La confirmación se emite cuando el dato es durable en el dispositivo
    // (D-15). Si dependiera de la red, el número dependería del Wi-Fi
    // de la bodega en vez de nuestro código.
    expect(ETAPAS_PERCIBIDAS).not.toContain('envio');
    expect(ETAPAS_PERCIBIDAS).not.toContain('validacion_servidor');
  });

  it('acepta una tanda dentro de presupuesto', () => {
    const v = evaluar(ETAPAS.map((etapa) => ({ etapa, p95: PRESUPUESTO_MS[etapa] })));
    expect(v.dentroDePresupuesto).toBe(true);
    expect(v.excedidas).toHaveLength(0);
  });

  it('señala QUÉ etapa se pasó, no solo que algo se puso lento', () => {
    // Es el punto entero de medir por etapa: un número agregado no permite
    // atribuir la degradación.
    const v = evaluar([
      { etapa: 'gramatica', p95: 15 },
      { etapa: 'transcripcion', p95: 900 },
    ]);

    expect(v.dentroDePresupuesto).toBe(false);
    expect(v.excedidas).toHaveLength(1);
    expect(v.excedidas[0]?.etapa).toBe('transcripcion');
  });

  it('detecta un ciclo desbordado aunque cada etapa quepa en su presupuesto', () => {
    // El caso sutil: varias etapas justo en su techo suman más que el ciclo.
    const v = evaluar(ETAPAS_PERCIBIDAS.map((etapa) => ({ etapa, p95: PRESUPUESTO_MS[etapa] + 1 })));
    expect(v.excedidas.length).toBe(ETAPAS_PERCIBIDAS.length);
    expect(v.dentroDePresupuesto).toBe(false);
  });
});
