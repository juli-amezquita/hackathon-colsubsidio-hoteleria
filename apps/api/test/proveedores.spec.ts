import { describe, expect, it } from 'vitest';

import { InterpretacionSimulada } from '../src/proveedores/interpretacion/simulado';
import { validarPropuesta } from '../src/proveedores/interpretacion/validacion';
import { VozSimulada } from '../src/proveedores/voz/simulado';

const CATALOGO = ['ACEITE DE OLIVA', 'ARROZ', 'PLATO BLANCO CUADRADO'];

describe('F-23/F-24 · credencial de voz', () => {
  it('emite un token efímero, nunca la credencial de cuenta', async () => {
    const c = await new VozSimulada().emitirCredencial({ usuarioId: 'u', rondaId: 'r', terminos: [] });

    expect(c.token).toMatch(/^simulado-/);
    // Corta en el tiempo: si se filtra, el daño dura un minuto.
    expect(new Date(c.expiraEn).getTime() - Date.now()).toBeLessThanOrEqual(61_000);
  });

  it('pide numerales formateados al modelo', () => {
    // Sin esto llegaría "diecinueve punto ocho" y habría que normalizar
    // números en español en el dispositivo.
    return new VozSimulada().emitirCredencial({ usuarioId: 'u', rondaId: 'r', terminos: [] }).then((c) => {
      expect(c.opciones['numerals']).toBe(true);
      expect(c.opciones['language']).toBe('es');
    });
  });
});

describe('F-29 · la salida del modelo vuelve a validación determinista', () => {
  const base = { confianza: 0.95, nota: null } as const;

  it('acepta una propuesta correcta y devuelve el nombre DEL CATÁLOGO', () => {
    const v = validarPropuesta(
      { ...base, nombre: 'aceite de oliva', cantidad: 3, unidad: 'Liter' },
      CATALOGO,
    );

    expect(v.aceptada).toBe(true);
    // Se guarda el nombre canónico, no el que escribió el modelo.
    if (v.aceptada) expect(v.nombre).toBe('ACEITE DE OLIVA');
  });

  it('RECHAZA un artículo que el modelo inventó', () => {
    // El caso que esta capa existe para atrapar: un nombre plausible que no
    // está en el catálogo de la bodega.
    const v = validarPropuesta(
      { ...base, nombre: 'ACEITE DE GIRASOL PREMIUM', cantidad: 3, unidad: 'Liter' },
      CATALOGO,
    );

    expect(v.aceptada).toBe(false);
    if (!v.aceptada) expect(v.motivo).toMatch(/no existe en el catálogo/i);
  });

  it('rechaza por confianza baja: preguntar es barato', () => {
    const v = validarPropuesta(
      { nombre: 'ARROZ', cantidad: 20, unidad: 'Kilogram', confianza: 0.5, nota: null },
      CATALOGO,
    );
    expect(v.aceptada).toBe(false);
  });

  it.each([
    [{ nombre: 'ARROZ', cantidad: -5, unidad: 'Kilogram' }, /número válido/i],
    [{ nombre: 'ARROZ', cantidad: 20, unidad: 'Gramos' }, /no pertenece al inventario/i],
    [{ nombre: null, cantidad: 20, unidad: 'Kilogram' }, /incompleta/i],
  ])('rechaza %o', (parcial, patron) => {
    const v = validarPropuesta({ ...base, ...parcial } as never, CATALOGO);
    expect(v.aceptada).toBe(false);
    if (!v.aceptada) expect(v.motivo).toMatch(patron);
  });

  it('cinturón: una fracción verbal no entra disfrazada de propuesta', () => {
    const v = validarPropuesta(
      { nombre: 'ARROZ', cantidad: 0.5, unidad: 'Kilogram', confianza: 0.95, nota: 'El operario dijo medio kilo' },
      CATALOGO,
    );
    expect(v.aceptada).toBe(false);
  });
});

describe('El intérprete simulado nunca inventa', () => {
  it('ante un turno que la gramática no resuelve, devuelve confianza cero', async () => {
    const r = await new InterpretacionSimulada().interpretar({
      textoDictado: 'eh no sé, ponle unos cuantos',
      catalogo: CATALOGO,
      bodegaId: 'x',
    });

    expect(r.propuesta.confianza).toBe(0);
    expect(r.propuesta.nombre).toBeNull();
    // Confianza cero significa "pregúntale al operario", no "guarda algo".
    expect(validarPropuesta(r.propuesta, CATALOGO).aceptada).toBe(false);
  });
});
