import { describe, expect, it } from 'vitest';

import { diagnosticar } from '../src/modules/aprendizaje/critico.service';

/**
 * El diagnóstico del crítico.
 *
 * Dos propiedades que la prueba sostiene y que valen más que la exactitud de
 * los umbrales:
 *
 *   1. **Cada hallazgo dice cómo se arregla.** Un informe que enumera problemas
 *      sin salida no se lee dos veces.
 *   2. **Ningún hallazgo habla de una persona.** Un crítico que califica
 *      operarios se usa contra ellos, y la herramienta se abandona.
 */

const ronda = (extra: Partial<Parameters<typeof diagnosticar>[0]> = {}) => ({
  registros: 100,
  correcciones: 0,
  sinGramatica: 0,
  desambiguadas: 0,
  discrepantes: 0,
  sinVerificacion: 0,
  ...extra,
});

describe('qué señala', () => {
  it('una ronda limpia no inventa problemas', () => {
    const h = diagnosticar(ronda());
    expect(h).toHaveLength(1);
    expect(h[0]!.punto).toBe('Sin puntos flojos');
  });

  it('la gramática corta, cuando pasa del umbral', () => {
    expect(diagnosticar(ronda({ sinGramatica: 30 }))[0]!.punto).toMatch(/gramática/i);
    // Justo por debajo no molesta: un crítico que señala todo no se lee.
    expect(diagnosticar(ronda({ sinGramatica: 15 }))[0]!.punto).toBe('Sin puntos flojos');
  });

  it('la desambiguación manual excesiva', () => {
    expect(diagnosticar(ronda({ desambiguadas: 25 }))[0]!.punto).toMatch(/elegir a mano/i);
  });

  it('las correcciones por encima de lo normal', () => {
    expect(diagnosticar(ronda({ correcciones: 30 }))[0]!.punto).toMatch(/corregir/i);
  });

  it('UNA sola resolución discrepante ya se señala', () => {
    // No hay umbral: que el dispositivo y el servidor difieran sobre QUÉ
    // artículo se contó no es cuestión de grado.
    expect(diagnosticar(ronda({ discrepantes: 1 }))[0]!.punto).toMatch(/no coincidieron/i);
  });

  it('una ronda sin conteos no produce diagnóstico', () => {
    expect(diagnosticar(ronda({ registros: 0 }))).toEqual([]);
  });
});

describe('cómo lo dice', () => {
  it('TODO hallazgo trae cómo se arregla', () => {
    const todos = [
      ...diagnosticar(ronda({ sinGramatica: 40 })),
      ...diagnosticar(ronda({ desambiguadas: 40 })),
      ...diagnosticar(ronda({ correcciones: 40 })),
      ...diagnosticar(ronda({ discrepantes: 3 })),
      ...diagnosticar(ronda({ sinVerificacion: 2 })),
      ...diagnosticar(ronda()),
    ];

    for (const h of todos) {
      expect(h.comoSeArregla.length, h.punto).toBeGreaterThan(3);
      expect(h.detalle.length, h.punto).toBeGreaterThan(10);
    }
  });

  it('⭐ ningún hallazgo califica a una persona', () => {
    // Es la propiedad que decide si esta función sirve o hace daño.
    const todos = [
      ...diagnosticar(ronda({ sinGramatica: 40, correcciones: 40, desambiguadas: 40, discrepantes: 2, sinVerificacion: 2 })),
      ...diagnosticar(ronda()),
    ];

    const prohibido = /operari[oa]s?\s+(mal|lent|descuidad|equivoc)|contó mal|error del operari|culpa/i;
    for (const h of todos) {
      const texto = `${h.punto} ${h.detalle} ${h.comoSeArregla}`;
      expect(prohibido.test(texto), `«${h.punto}» califica a la persona`).toBe(false);
    }
  });

  it('el sujeto de los hallazgos es el sistema', () => {
    const h = diagnosticar(ronda({ sinGramatica: 40 }))[0]!;
    // "La gramática se quedó corta", no "el operario dictó mal".
    expect(h.punto).toMatch(/gramática|catálogo|dispositivo|servidor|sistema|corregir/i);
  });

  it('varios problemas a la vez se acumulan, no se pisan', () => {
    const h = diagnosticar(ronda({ sinGramatica: 40, desambiguadas: 40, discrepantes: 1 }));
    expect(h.length).toBe(3);
  });
});
