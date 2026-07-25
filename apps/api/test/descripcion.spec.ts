import { describe, expect, it } from 'vitest';

import { evaluarDescripcion } from '../src/modules/captura/descripcion';

/**
 * H5-01 · Los criterios objetivos de descripción detallada (FR-5.2).
 *
 * Lo que se prueba aquí es que la regla sea REPRODUCIBLE. Un rechazo que el
 * operario no puede predecir —ni repetir— es una función que se desactiva la
 * primera semana, y con ella se pierde el único registro que existe de la
 * mercancía que hoy se cae del inventario.
 */

describe('lo que se rechaza', () => {
  it('una descripción demasiado corta', () => {
    const r = evaluarDescripcion('caja azul');
    expect(r.aceptada).toBe(false);
    expect(r.motivo).toMatch(/al menos 20 caracteres/);
  });

  it('la misma palabra repetida hasta llegar al largo', () => {
    const r = evaluarDescripcion('galletas galletas galletas galletas');
    expect(r.aceptada).toBe(false);
    expect(r.motivo).toMatch(/palabras distintas/);
  });

  it('una descripción larga pero hecha solo de palabras genéricas', () => {
    // 40 caracteres, seis palabras distintas, y no dice absolutamente nada.
    const r = evaluarDescripcion('caja grande de producto sin marca desconocido');
    expect(r.aceptada).toBe(false);
    expect(r.motivo).toMatch(/genérica/);
  });

  it('el clásico "no se que es esto que esta aqui"', () => {
    expect(evaluarDescripcion('no se que es esto que esta aqui').aceptada).toBe(false);
  });
});

describe('lo que se acepta', () => {
  it('una descripción real de bodega', () => {
    expect(evaluarDescripcion('Caja de galletas Festival sabor vainilla x 12 unidades').aceptada).toBe(true);
  });

  it('sirve con dos datos que distingan, aunque el resto sea genérico', () => {
    expect(evaluarDescripcion('bolsa grande de arroz Diana por libra').aceptada).toBe(true);
  });

  it('los acentos y las mayúsculas no cambian el veredicto', () => {
    const con = evaluarDescripcion('Botellón de agua Cristal presentación 20 litros');
    const sin = evaluarDescripcion('botellon de agua cristal presentacion 20 litros');
    expect(con).toEqual(sin);
    expect(con.aceptada).toBe(true);
  });

  it('no juzga si la descripción es CORRECTA, solo si es específica', () => {
    // El sistema no sabe si esto existe. Tampoco le toca: la Restricción 1
    // prohíbe delegar el juicio, y quien decide es el Auditor.
    expect(evaluarDescripcion('Chocolatina Jet edición coleccionista sabor maracumango').aceptada).toBe(true);
  });
});
