import { describe, expect, it } from 'vitest';

import { clasificar, type AfirmacionDeRonda } from '../src/modules/consolidacion/clasificacion';

/**
 * H3-02, H3-03, H3-07 · La regla que decide qué se da por bueno.
 *
 * Lo que esta función marca `conciliado` termina publicándose al ERP como
 * inventario real sin que ninguna persona lo revise. Es el único punto del
 * sistema donde una decisión automática tiene consecuencia contable, así que
 * cada camino que llega ahí está probado por separado.
 */

const KG = 'unidad-kg';

const ronda = (extra: Partial<AfirmacionDeRonda> = {}): AfirmacionDeRonda => ({
  rondaId: `ronda-${Math.trunc(Number(extra.cantidad ?? 0))}`,
  estado: 'contado',
  cantidad: '100.000',
  unidadId: KG,
  resultadoValidacion: 'aceptado',
  saldoEsperadoCongelado: '100.000',
  ...extra,
});

describe('una ronda basta para conciliar (D5, FR-3.2, FR-3.5)', () => {
  it('coincidir con el saldo esperado concilia con UNA sola ronda', () => {
    const c = clasificar([ronda()]);
    expect(c.clasificacion).toBe('conciliado');
    expect(c.motivo).toBeNull();
    expect(c.valorFinal).toBe('100.000');
    expect(c.origenValor).toBe('conteo_ciego');
    expect(c.rondasAfirmando).toBe(1);
  });

  it('una segunda ronda que coincide respalda, no cambia el resultado', () => {
    const c = clasificar([ronda(), ronda()]);
    expect(c.clasificacion).toBe('conciliado');
    expect(c.rondasAfirmando).toBe(2);
  });

  it('nada es auditable por el solo hecho de haber una única ronda (escenario 7)', () => {
    expect(clasificar([ronda()]).motivo).toBeNull();
  });

  it('contado en cero contra saldo cero es una afirmación y concilia (escenario 6)', () => {
    const c = clasificar([
      ronda({ estado: 'contado_en_cero', cantidad: '0', saldoEsperadoCongelado: '0.000' }),
    ]);
    expect(c.clasificacion).toBe('conciliado');
    expect(c.valorFinal).toBe('0');
  });
});

describe('lo que manda un artículo al Auditor (FR-3.3)', () => {
  it('discrepancia contra el saldo esperado', () => {
    const c = clasificar([ronda({ resultadoValidacion: 'alerta_discrepancia' })]);
    expect(c).toMatchObject({ clasificacion: 'auditable', motivo: 'discrepancia' });
  });

  it('la alerta de unidad también es diferencia', () => {
    expect(clasificar([ronda({ resultadoValidacion: 'alerta_unidad' })]).motivo).toBe('discrepancia');
  });

  it('un artículo que agotó sus verificaciones no se puede conciliar', () => {
    // Llegó a `sin_verificacion` porque los intentos previos alertaron. No se
    // concilia lo que el sistema dejó de validar.
    expect(clasificar([ronda({ resultadoValidacion: 'sin_verificacion' })]).motivo).toBe('discrepancia');
  });

  it('sin saldo esperado nunca concilia (FR-2.10)', () => {
    const c = clasificar([ronda({ saldoEsperadoCongelado: null, resultadoValidacion: 'no_validable' })]);
    expect(c).toMatchObject({ clasificacion: 'auditable', motivo: 'sin_saldo_esperado' });
  });

  it('ninguna ronda afirmó nada: sin cobertura (escenario 5)', () => {
    const c = clasificar([ronda({ estado: 'no_contado', cantidad: null, unidadId: null })]);
    expect(c).toMatchObject({ clasificacion: 'auditable', motivo: 'sin_cobertura', rondasAfirmando: 0 });
  });

  it('un artículo que ninguna ronda tocó también es sin cobertura', () => {
    // Es el caso del artículo agregado al catálogo después de cerrar la ronda.
    expect(clasificar([]).motivo).toBe('sin_cobertura');
  });

  it('lo auditable NUNCA lleva valor final (FR-3.4)', () => {
    const c = clasificar([ronda({ resultadoValidacion: 'alerta_discrepancia' })]);
    expect(c.valorFinal).toBeNull();
    expect(c.origenValor).toBeNull();
  });
});

describe('contradicción entre rondas (FR-3.4, escenario 3)', () => {
  it('dos cantidades distintas van al Auditor sin que el sistema elija', () => {
    const c = clasificar([ronda({ cantidad: '100.000' }), ronda({ cantidad: '98.000' })]);
    expect(c).toMatchObject({ clasificacion: 'auditable', motivo: 'contradiccion_entre_rondas' });
    expect(c.valorFinal).toBeNull();
  });

  it('contradicen aunque AMBAS estén dentro de tolerancia contra el sistema', () => {
    // Es la parte contraintuitiva del escenario 3: las dos conciliarían por
    // separado. Que dos personas midan distinto el mismo día no lo explica
    // la merma — lo explica que alguien contó mal.
    const c = clasificar([
      ronda({ cantidad: '100.000', resultadoValidacion: 'aceptado' }),
      ronda({ cantidad: '99.900', resultadoValidacion: 'aceptado' }),
    ]);
    expect(c.motivo).toBe('contradiccion_entre_rondas');
  });

  it('la misma cantidad escrita distinto NO es contradicción', () => {
    // Postgres devuelve `"5"`, `"5.0"` o `"5.000"` según por dónde pase el
    // valor. Comparar cadenas daría tres números diferentes.
    const c = clasificar([ronda({ cantidad: '5' }), ronda({ cantidad: '5.000' })]);
    expect(c.clasificacion).toBe('conciliado');
  });

  it('la misma cantidad en unidades distintas SÍ es contradicción', () => {
    const c = clasificar([ronda({ cantidad: '5' }), ronda({ cantidad: '5', unidadId: 'otra' })]);
    expect(c.motivo).toBe('contradiccion_entre_rondas');
  });

  it('una ronda que no contó no contradice a la que sí (FR-3.9)', () => {
    const c = clasificar([
      ronda(),
      ronda({ estado: 'no_contado', cantidad: null, unidadId: null }),
    ]);
    expect(c.clasificacion).toBe('conciliado');
    expect(c.rondasAfirmando).toBe(1);
  });
});

describe('la regla conservadora (FR-3.10, escenario 4)', () => {
  it('basta con que UNA ronda haya producido diferencia, aunque otra coincida', () => {
    const c = clasificar([
      ronda({ cantidad: '100.000', resultadoValidacion: 'aceptado' }),
      ronda({ cantidad: '100.000', resultadoValidacion: 'alerta_discrepancia' }),
    ]);
    expect(c.clasificacion).toBe('auditable');
  });

  it('tres rondas: una discrepante arrastra a las otras dos', () => {
    const c = clasificar([
      ronda({ resultadoValidacion: 'aceptado' }),
      ronda({ resultadoValidacion: 'aceptado' }),
      ronda({ resultadoValidacion: 'alerta_discrepancia' }),
    ]);
    expect(c).toMatchObject({ clasificacion: 'auditable', motivo: 'discrepancia', rondasAfirmando: 3 });
  });

  it('cuando contradicción y discrepancia aplican, gana contradicción', () => {
    // Es el motivo más específico: dice que hay dos versiones humanas que
    // comparar, no solo una cifra que no cuadra con el sistema.
    const c = clasificar([
      ronda({ cantidad: '100.000', resultadoValidacion: 'aceptado' }),
      ronda({ cantidad: '50.000', resultadoValidacion: 'alerta_discrepancia' }),
    ]);
    expect(c.motivo).toBe('contradiccion_entre_rondas');
  });
});
