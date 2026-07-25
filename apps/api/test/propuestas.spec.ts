import { describe, expect, it } from 'vitest';

import { proponer } from '../src/modules/aprendizaje/propuestas';
import type { SenalesDeCaptura } from '../src/platform/dominio/senales';

/**
 * De las señales a las propuestas.
 *
 * Lo que se prueba aquí es el CRITERIO: qué merece proponerse y qué no. Un
 * reporte que propone treinta cosas no se lee, y uno que propone lo obvio se
 * deja de leer a la segunda vez.
 */

const vacias: SenalesDeCaptura = {
  registros: 0,
  correcciones: 0,
  porOrigenParse: {},
  porOrigenNombre: {},
  resolucionesDiscrepantes: 0,
  textosSinResolver: [],
  desambiguaciones: [],
  correccionesNumericas: [],
  fantasmasConCandidatosDescartados: 0,
};

const SIN_ALIAS = new Set<string>();

describe('alias: lo que N personas ya decidieron a mano', () => {
  const desambiguacion = (veces: number) => ({
    ...vacias,
    desambiguaciones: [
      { texto: 'aceite oliva', articuloId: 'a1', articulo: 'ACEITE DE OLIVA 10ML /BOLS', bodegaId: 'b1', veces },
    ],
  });

  it('con tres o más, propone el alias', () => {
    const p = proponer(desambiguacion(4), SIN_ALIAS);
    expect(p).toHaveLength(1);
    expect(p[0]!.tipo).toBe('alias');
    expect(p[0]!.accion).toContain('ACEITE DE OLIVA 10ML /BOLS');
    // La evidencia son números, no adjetivos.
    expect(p[0]!.evidencia).toContain('4 operarios');
    expect(p[0]!.aplicable).toMatchObject({ articuloId: 'a1', bodegaId: 'b1', alias: 'aceite oliva' });
  });

  it('con dos NO lo propone: puede ser casualidad', () => {
    expect(proponer(desambiguacion(2), SIN_ALIAS)).toHaveLength(0);
  });

  it('no propone un alias que ya existe en esa bodega', () => {
    expect(proponer(desambiguacion(9), new Set(['b1|aceite oliva']))).toHaveLength(0);
  });

  it('el alias propuesto va normalizado: es como la resolución busca', () => {
    const p = proponer(
      {
        ...vacias,
        desambiguaciones: [
          { texto: '  Aceite de OLIVA  ', articuloId: 'a1', articulo: 'ACEITE', bodegaId: 'b1', veces: 3 },
        ],
      },
      SIN_ALIAS,
    );
    // Guardar el texto crudo daría un alias que la búsqueda nunca encuentra.
    expect(p[0]!.aplicable?.alias).toBe('aceite de oliva');
  });
});

describe('gramática: los textos que la derrotaron', () => {
  it('propone convertirlos en casos de prueba', () => {
    const p = proponer(
      {
        ...vacias,
        textosSinResolver: [{ texto: 'dos cajas y media de arroz', veces: 5, origenParse: 'modelo' }],
      },
      SIN_ALIAS,
    );
    expect(p[0]!.tipo).toBe('gramatica');
    expect(p[0]!.accion).toContain('dos cajas y media de arroz');
    // No es aplicable con un clic: se convierte en código y tests, que es donde
    // el pulido es permanente y no cuesta por llamada.
    expect(p[0]!.aplicable).toBeNull();
  });
});

describe('confusiones al oír: el caso de "34 en vez de 24"', () => {
  const correccion = (antes: string, despues: string) => ({
    texto: null, antes, despues, articulo: 'ARROZ',
  });

  it('agrupa las que difieren en un solo dígito y se repiten', () => {
    const p = proponer(
      { ...vacias, correccionesNumericas: [correccion('34', '24'), correccion('34', '24')] },
      SIN_ALIAS,
    );
    expect(p[0]!.tipo).toBe('confusion_numerica');
    expect(p[0]!.accion).toContain('34 → 24');
  });

  it('IGNORA las que no parecen una confusión al oír', () => {
    // Contar 24 y corregir a 300 es un error de conteo, no de escucha. Meterlo
    // aquí ahogaría la señal que sí sirve.
    const p = proponer(
      { ...vacias, correccionesNumericas: [correccion('24', '300'), correccion('24', '300')] },
      SIN_ALIAS,
    );
    expect(p).toHaveLength(0);
  });

  it('una sola vez no es un patrón', () => {
    expect(proponer({ ...vacias, correccionesNumericas: [correccion('34', '24')] }, SIN_ALIAS)).toHaveLength(0);
  });

  it('los decimales no entran: la confusión de dígitos es de enteros', () => {
    const p = proponer(
      {
        ...vacias,
        correccionesNumericas: [correccion('24.500', '24.600'), correccion('24.500', '24.600')],
      },
      SIN_ALIAS,
    );
    expect(p).toHaveLength(0);
  });
});

describe('el reporte no se llena de ruido', () => {
  it('sin señales no propone nada', () => {
    expect(proponer(vacias, SIN_ALIAS)).toEqual([]);
  });

  it('ordena por evidencia: lo más repetido primero', () => {
    const p = proponer(
      {
        ...vacias,
        desambiguaciones: [
          { texto: 'poco', articuloId: 'a', articulo: 'A', bodegaId: 'b', veces: 3 },
          { texto: 'mucho', articuloId: 'c', articulo: 'C', bodegaId: 'b', veces: 20 },
        ],
      },
      SIN_ALIAS,
    );
    expect(p.map((x) => x.veces)).toEqual([20, 3]);
  });

  it('NINGUNA propuesta que mueva un umbral es aplicable con un clic', () => {
    const p = proponer(
      {
        ...vacias,
        desambiguaciones: [{ texto: 'x y', articuloId: 'a', articulo: 'A', bodegaId: 'b', veces: 5 }],
        textosSinResolver: [{ texto: 'algo raro', veces: 3, origenParse: 'manual' }],
        correccionesNumericas: [
          { texto: null, antes: '15', despues: '50', articulo: 'A' },
          { texto: null, antes: '15', despues: '50', articulo: 'A' },
        ],
        fantasmasConCandidatosDescartados: 4,
      },
      SIN_ALIAS,
    );

    // Solo los alias se aplican: son datos, reversibles, y codifican lo que
    // varias personas ya decidieron. Todo lo demás es para leer y actuar.
    const aplicables = p.filter((x) => x.aplicable !== null);
    expect(aplicables.every((x) => x.tipo === 'alias')).toBe(true);
    expect(p.length).toBeGreaterThan(aplicables.length);
  });
});
