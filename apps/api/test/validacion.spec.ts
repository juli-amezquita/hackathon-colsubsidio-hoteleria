import { describe, expect, it } from 'vitest';

import { MAX_VERIFICACIONES, validar, type ContextoValidacion } from '../src/modules/captura/validacion';
import { aEntero, dentroDeTolerancia } from '../src/platform/numeros/decimal';

/**
 * H2-01 a H2-04 · Las reglas de validación, sin base de datos.
 *
 * Son las condiciones que deciden si el sistema alerta a un operario que está
 * frente al estante. Se prueban aquí, aisladas, porque un error en el límite
 * exacto de la tolerancia no se ve en una prueba de extremo a extremo: se ve
 * meses después, en un artículo que nadie entiende por qué quedó auditable.
 */

const UNIDAD = 'u-esperada';
const OTRA = 'u-distinta';

const ctx = (extra: Partial<ContextoValidacion> = {}): ContextoValidacion => ({
  estado: 'contado',
  cantidad: '100.000',
  unidadId: UNIDAD,
  unidadEsperadaId: UNIDAD,
  esPeso: false,
  saldoEsperado: '100.000',
  toleranciaMerma: null,
  verificacionesPrevias: 0,
  ...extra,
});

describe('aritmética decimal exacta', () => {
  it('escala decimales en texto sin pasar por coma flotante', () => {
    expect(aEntero('12.5', 3)).toBe(12500n);
    expect(aEntero('0.002', 4)).toBe(20n);
    expect(aEntero('-33.750', 3)).toBe(-33750n);
    expect(aEntero('7', 3)).toBe(7000n);
  });

  it('el límite EXACTO de la tolerancia cae dentro', () => {
    // 0.2% de 1000 = 2 exactos. Es el edge case explícito de la especificación
    // y el que la coma flotante decide por el último bit de la mantisa.
    expect(dentroDeTolerancia('998.000', '1000.000', '0.0020')).toBe(true);
    expect(dentroDeTolerancia('1002.000', '1000.000', '0.0020')).toBe(true);
    expect(dentroDeTolerancia('997.999', '1000.000', '0.0020')).toBe(false);
    expect(dentroDeTolerancia('1002.001', '1000.000', '0.0020')).toBe(false);
  });

  it('un saldo negativo no invierte el límite', () => {
    // El archivo real del cliente trae 79 saldos negativos. Sin valor absoluto
    // el límite saldría negativo y NADA cabría nunca dentro de tolerancia.
    expect(dentroDeTolerancia('-99.000', '-100.000', '0.0200')).toBe(true);
    expect(dentroDeTolerancia('-95.000', '-100.000', '0.0200')).toBe(false);
  });

  it('tolerancia cero exige coincidencia exacta', () => {
    expect(dentroDeTolerancia('100.000', '100.000', '0')).toBe(true);
    expect(dentroDeTolerancia('100.001', '100.000', '0')).toBe(false);
  });
});

describe('la unidad se valida antes que la cantidad (FR-2.1)', () => {
  it('alerta e informa cuál es la correcta', () => {
    expect(validar(ctx({ unidadId: OTRA })).veredicto).toBe('alerta_unidad');
  });

  it('la unidad equivocada corta: no se compara una cantidad sin sentido', () => {
    // 20 unidades contra 20 kilos no es una discrepancia, es una comparación
    // que no significa nada. El veredicto es de unidad, no de cantidad.
    const r = validar(ctx({ unidadId: OTRA, cantidad: '5.000', saldoEsperado: '900.000' }));
    expect(r.veredicto).toBe('alerta_unidad');
    expect(r.toleranciaAplicada).toBeNull();
  });
});

describe('comparación contra el saldo esperado (FR-2.2, FR-2.3)', () => {
  it('coincidir con el saldo no alerta', () => {
    expect(validar(ctx()).veredicto).toBe('aceptado');
  });

  it('sin peso, CUALQUIER diferencia alerta', () => {
    // No hay evaporación de botellas (escenario 5).
    const r = validar(ctx({ cantidad: '99.000', esPeso: false, toleranciaMerma: '0.0020' }));
    expect(r.veredicto).toBe('alerta_discrepancia');
    expect(r.toleranciaAplicada).toBe('0');
  });

  it('con peso, una diferencia dentro de la merma no alerta', () => {
    const r = validar(ctx({ cantidad: '99.900', esPeso: true, toleranciaMerma: '0.0020' }));
    expect(r.veredicto).toBe('aceptado');
    expect(r.toleranciaAplicada).toBe('0.0020');
  });

  it('con peso, alerta al superar la merma tanto a favor como en contra', () => {
    expect(validar(ctx({ cantidad: '95.000', esPeso: true, toleranciaMerma: '0.0020' })).veredicto)
      .toBe('alerta_discrepancia');
    expect(validar(ctx({ cantidad: '105.000', esPeso: true, toleranciaMerma: '0.0020' })).veredicto)
      .toBe('alerta_discrepancia');
  });

  it('unidad de peso SIN merma configurada aplica tolerancia cero y lo deja visible', () => {
    const r = validar(ctx({ cantidad: '99.999', esPeso: true, toleranciaMerma: null }));
    expect(r.veredicto).toBe('alerta_discrepancia');
    // La huella de que faltaba configurarla: peso con tolerancia 0.
    expect(r.toleranciaAplicada).toBe('0');
  });

  it('sin saldo esperado el conteo NO se descarta: queda no validable (FR-2.10)', () => {
    const r = validar(ctx({ saldoEsperado: null }));
    expect(r.veredicto).toBe('no_validable');
    expect(r.esAlerta).toBe(false);
  });
});

describe('contado en cero y no contado (FR-2.7)', () => {
  it('contado en cero es una cantidad y se valida', () => {
    const r = validar(ctx({ estado: 'contado_en_cero', cantidad: '0', saldoEsperado: '40.000' }));
    expect(r.veredicto).toBe('alerta_discrepancia');
  });

  it('contado en cero contra saldo cero concilia', () => {
    expect(validar(ctx({ estado: 'contado_en_cero', cantidad: '0', saldoEsperado: '0.000' })).veredicto)
      .toBe('aceptado');
  });

  it('no contado NO genera discrepancia: no afirmó nada', () => {
    const r = validar(ctx({ estado: 'no_contado', cantidad: null, unidadId: null, saldoEsperado: '40.000' }));
    expect(r.veredicto).toBe('no_validable');
    expect(r.esAlerta).toBe(false);
  });
});

describe('la alerta no puede usarse como oráculo del saldo (FR-1.18)', () => {
  it('el veredicto no distingue si sobra o si falta', () => {
    // Misma respuesta en las dos direcciones. Es lo que impide que "falta" más
    // "reintenta" se convierta en una búsqueda binaria del saldo esperado.
    const menos = validar(ctx({ cantidad: '10.000', saldoEsperado: '100.000' }));
    const mas = validar(ctx({ cantidad: '190.000', saldoEsperado: '100.000' }));
    expect(menos).toEqual(mas);
  });

  it('las verificaciones se agotan', () => {
    const r = validar(ctx({ cantidad: '1.000', verificacionesPrevias: MAX_VERIFICACIONES }));
    expect(r.veredicto).toBe('sin_verificacion');
    expect(r.esAlerta).toBe(false);
  });

  it('agotadas, la respuesta ya no depende de la cantidad dictada', () => {
    // El sondeo deja de dar información: acertar y errar responden igual.
    const acierta = validar(ctx({ cantidad: '100.000', verificacionesPrevias: 5 }));
    const falla = validar(ctx({ cantidad: '3.000', verificacionesPrevias: 5 }));
    expect(acierta).toEqual(falla);
  });
});
