import { describe, expect, it } from 'vitest';

import { cubierto, leerNumero, normalizar, parsear } from '../src/index';

/** Turnos reales tal como los diría un operario en la bodega. */
describe('F-26 · la gramática separa nombre, cantidad y unidad', () => {
  it.each([
    ['platos cuadrados, tres unidades', 'platos cuadrados', 3, 'Unidad'],
    ['aceite de oliva dos litros', 'aceite de oliva', 2, 'Liter'],
    ['arroz veinte kilos', 'arroz', 20, 'Kilogram'],
    ['arroz 20 kg', 'arroz', 20, 'Kilogram'],
    ['cerveza heineken cero cuarenta y ocho unidades', 'cerveza heineken cero', 48, 'Unidad'],
    ['porcion de mojarra tres porciones', 'porcion de mojarra', 3, 'Portion'],
    ['acelga ciento veintitres kilos', 'acelga', 123, 'Kilogram'],
    ['agua botella dos mil unidades', 'agua botella', 2000, 'Unidad'],
  ])('%s', (texto, nombre, cantidad, unidad) => {
    const r = parsear(texto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nombre).toBe(nombre);
    expect(r.cantidad).toBe(cantidad);
    expect(r.unidad).toBe(unidad);
  });

  it.each([
    ['aceite diecinueve punto ocho litros', 19.8],
    ['aceite 19.8 litros', 19.8],
    ['aceite diecinueve coma ocho litros', 19.8],
    ['ajonjoli dos con cinco kilos', 2.5],
    ['albahaca cero punto cero seis kilos', 0.06],
  ])('decimales: %s', (texto, cantidad) => {
    const r = parsear(texto);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cantidad).toBeCloseTo(cantidad, 3);
  });
});

describe('FR-1.9 · las fracciones verbales se RECHAZAN', () => {
  // "Medio kilo" son 500 g para uno y 400 para otro según el envase que tenga
  // en la mano. Esa ambigüedad terminaría en una discrepancia que el Auditor
  // tendría que ir a resolver caminando.
  it.each(['sal medio kilo', 'arroz un cuarto de kilo', 'aceite media botella', 'huevos una docena'])(
    '%s',
    (texto) => {
      const r = parsear(texto);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe('fraccion_verbal');
    },
  );
});

describe('El nombre que lleva un número dentro', () => {
  it('"aceite de oliva 10ml bolsa dos unidades" toma la cola correcta', () => {
    const r = parsear('aceite de oliva 10 ml bolsa dos unidades');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // La cantidad es "dos unidades"; el "10 ml" es parte del nombre del artículo.
    expect(r.cantidad).toBe(2);
    expect(r.unidad).toBe('Unidad');
    expect(r.nombre).toContain('aceite de oliva');
  });

  it('señala que el nombre arrastra una cantidad, sin intentar resolverlo', () => {
    // "aceite 3 litros" puede ser el artículo "ACEITE 3 LITROS" o 3 litros de
    // aceite. La gramática no puede saberlo — es una pregunta para el catálogo.
    const r = parsear('aceite 3 litros 2 unidades');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cantidad).toBe(2);
    expect(r.nombre).toBe('aceite 3 litros');
    expect(r.nombreLlevaCantidad).toBe(true);
    expect(cubierto(r)).toBe(false); // exige preguntar: no cuenta como cubierto
  });

  it('un nombre normal NO se marca como ambiguo', () => {
    const r = parsear('arroz blanco veinte kilos');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nombreLlevaCantidad).toBe(false);
      expect(cubierto(r)).toBe(true);
    }
  });
});

describe('Unidades que la gente dice pero no están en el catálogo', () => {
  it('NO convierte gramos a kilos por su cuenta', () => {
    // Convertir en silencio escribiría en el libro una cantidad que el operario
    // nunca dijo.
    const r = parsear('sal quinientos gramos');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('unidad_no_soportada');
  });
});

describe('Lo que la gramática NO resuelve escala al modelo (D-09)', () => {
  it.each([
    ['veinte kilos', 'sin_nombre'],
    ['arroz blanco', 'sin_cantidad'],
    ['eh... no sé, ponle unos cuantos', 'sin_cantidad'],
    ['', 'vacio'],
  ])('%s → %s', (texto, motivo) => {
    const r = parsear(texto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe(motivo);
  });
});

describe('Normalización y números sueltos', () => {
  it('quita tildes y puntuación, conserva el decimal', () => {
    expect(normalizar('  Porción   de  MOJARRA, 19,8 ')).toBe('porcion de mojarra 19,8');
  });

  it.each([
    [['cuarenta', 'y', 'ocho'], 48],
    [['ciento', 'veintitres'], 123],
    [['dos', 'mil'], 2000],
    [['mil'], 1000],
    [['novecientos', 'noventa', 'y', 'nueve'], 999],
    [['cero'], 0],
  ])('%s = %i', (palabras, valor) => {
    const r = leerNumero(palabras);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBe(valor);
  });
});
