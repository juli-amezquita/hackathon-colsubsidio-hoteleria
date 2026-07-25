import { describe, expect, it } from 'vitest';

import { ArbitroAnthropic } from '../src/proveedores/arbitraje/anthropic';
import { ArbitroDeterminista } from '../src/proveedores/arbitraje/determinista';
import type { EntradaArbitraje } from '../src/proveedores/arbitraje/proveedor';
import { InterpretacionSimulada } from '../src/proveedores/interpretacion/simulado';
import { VozSimulada } from '../src/proveedores/voz/simulado';

/**
 * H6-07 · Prueba E8 — degradación de proveedores (Restricción 5).
 *
 * Todo proveedor externo tiene alternativa, y la alternativa no es un maniquí
 * que devuelve vacío: es un camino por el que el inventario SE PUEDE TERMINAR.
 *
 * La pregunta que responde esta prueba no es "¿maneja el error?" sino algo más
 * exigente: **si este proveedor no existiera hoy, ¿el operario podría contar y
 * el Auditor cerrar?** Un sistema que se cae porque una API de terceros tiene
 * un mal día no sirve para un inventario que ocurre una vez al mes y no se
 * puede reprogramar.
 */

const CASO: EntradaArbitraje = {
  articulo: 'ACEITE DE OLIVA',
  unidad: 'Liter',
  motivo: 'discrepancia',
  saldoEsperado: '40.000',
  toleranciaAplicada: '0',
  registros: [
    {
      ronda: 'ronda-1',
      operador: 'Ana',
      cuando: '2026-07-25T10:00:00.000Z',
      cantidad: '12.000',
      estado: 'contado',
      veredicto: 'alerta_discrepancia',
    },
  ],
};

describe('el árbitro sin modelo (H4-05)', () => {
  it('sigue ordenando el caso: relato, observaciones y preguntas', async () => {
    const r = await new ArbitroDeterminista().ordenar(CASO);

    expect(r.proveedor).toBe('determinista');
    expect(r.sintesis.relato).toContain('Ana');
    expect(r.sintesis.preguntas.length).toBeGreaterThan(0);
    expect(r.sintesis.razonesPlausibles.length).toBeGreaterThan(0);
  });

  it('tampoco emite veredicto: la degradación no relaja la regla', async () => {
    const r = await new ArbitroDeterminista().ordenar(CASO);
    expect(Object.keys(r.sintesis).sort()).toEqual([
      'observaciones', 'preguntas', 'razonesPlausibles', 'relato',
    ]);
  });

  it('el árbitro con modelo cae al determinista cuando la API falla', async () => {
    // Sin credencial válida la llamada revienta. Lo que importa es que el
    // Auditor reciba el caso ordenado igual: la síntesis es una ayuda para
    // leerlo, no un requisito para resolverlo.
    const r = await new ArbitroAnthropic(new ArbitroDeterminista()).ordenar(CASO);

    expect(r.proveedor).toBe('determinista');
    expect(r.sintesis.relato).toContain('Ana');
  }, 30_000);

  it('un caso sin ninguna ronda no lo hace fallar', async () => {
    const r = await new ArbitroDeterminista().ordenar({ ...CASO, registros: [], motivo: 'sin_cobertura' });
    expect(r.sintesis.relato).toMatch(/Ninguna ronda/);
    expect(r.sintesis.preguntas.length).toBeGreaterThan(0);
  });

  it('sin saldo esperado lo dice, en vez de callar', async () => {
    const r = await new ArbitroDeterminista().ordenar({ ...CASO, saldoEsperado: null, motivo: 'sin_saldo_esperado' });
    expect(r.sintesis.observaciones.join(' ')).toMatch(/no tiene saldo esperado/i);
  });
});

describe('la voz sin Deepgram (F-24)', () => {
  it('emite una credencial utilizable, no un error', async () => {
    const c = await new VozSimulada().emitirCredencial({ usuarioId: 'u', rondaId: 'r', terminos: [] });
    expect(c.token).toBeTruthy();
    expect(new Date(c.expiraEn).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('la interpretación sin modelo (F-28)', () => {
  it('devuelve confianza CERO en vez de adivinar', async () => {
    // Es la degradación correcta: por debajo del umbral el sistema pregunta al
    // operario. Devolver una propuesta inventada con confianza alta sería
    // mucho peor que no responder.
    const r = await new InterpretacionSimulada().interpretar({
      textoDictado: 'algo que la gramática no resolvió',
      catalogo: ['ARROZ'],
      bodegaId: 'b',
    });

    expect(r.propuesta.confianza).toBe(0);
    expect(r.propuesta.nota).toBeTruthy();
  });

  it('no consume tokens: el diagnóstico de caché queda en cero', async () => {
    const r = await new InterpretacionSimulada().interpretar({
      textoDictado: 'x', catalogo: [], bodegaId: 'b',
    });
    expect(r.uso).toMatchObject({ entrada: 0, salida: 0 });
  });
});

describe('lo que la degradación NO puede tocar', () => {
  it('ningún proveedor externo participa en la validación (Restricción 1)', async () => {
    // La validación contra el saldo, la clasificación y los criterios de
    // descripción son funciones puras sin red. Que un proveedor caiga no puede
    // cambiar un veredicto, porque ninguno interviene en producirlo.
    const { validar } = await import('../src/modules/captura/validacion');
    const { clasificar } = await import('../src/modules/consolidacion/clasificacion');
    const { evaluarDescripcion } = await import('../src/modules/captura/descripcion');

    expect(
      validar({
        estado: 'contado', cantidad: '10.000', unidadId: 'u', unidadEsperadaId: 'u',
        esPeso: false, saldoEsperado: '10.000', toleranciaMerma: null, verificacionesPrevias: 0,
      }).veredicto,
    ).toBe('aceptado');

    expect(
      clasificar([{
        rondaId: 'r', estado: 'contado', cantidad: '10.000', unidadId: 'u',
        resultadoValidacion: 'aceptado', saldoEsperadoCongelado: '10.000',
        resolucionDiscrepante: false,
      }]).clasificacion,
    ).toBe('conciliado');

    expect(evaluarDescripcion('Caja de galletas Festival sabor vainilla x 12').aceptada).toBe(true);
  });
});
