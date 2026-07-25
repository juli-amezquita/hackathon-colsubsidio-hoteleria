import { Injectable } from '@nestjs/common';

import { ESCALA_CANTIDAD, aEntero, abs } from '../../platform/numeros/decimal';
import type { EntradaArbitraje, ProveedorDeArbitraje, ResultadoArbitraje } from './proveedor';

/**
 * Árbitro determinista — la alternativa obligatoria (Restricción 5).
 *
 * No es un maniquí. Ordena el mismo caso con reglas y produce una síntesis
 * legible; lo que no hace es redactar. Si mañana Anthropic no responde, el
 * Auditor sigue viendo el caso ordenado y puede trabajar, que es todo lo que
 * una alternativa tiene que garantizar.
 *
 * También es lo que corre en las pruebas: un árbitro con modelo haría la
 * prueba lenta, cara y no determinista, y no verificaría nada que este no
 * verifique — porque lo que hay que verificar es que el árbitro NO emita
 * veredictos, y eso se comprueba en la forma de la salida.
 */
@Injectable()
export class ArbitroDeterminista implements ProveedorDeArbitraje {
  readonly nombre = 'determinista';

  ordenar(entrada: EntradaArbitraje): Promise<ResultadoArbitraje> {
    const contados = entrada.registros.filter((r) => r.cantidad !== null);
    const cantidades = contados.map((r) => aEntero(r.cantidad!, ESCALA_CANTIDAD));
    const esperado = entrada.saldoEsperado === null ? null : aEntero(entrada.saldoEsperado, ESCALA_CANTIDAD);

    const relato = contados.length === 0
      ? `Ninguna ronda afirmó nada sobre ${entrada.articulo}.`
      : contados
          .map((r) => `${r.operador} contó ${r.cantidad} ${entrada.unidad} el ${r.cuando.slice(0, 10)}`)
          .join('; ') + '.';

    const observaciones: string[] = [];

    if (cantidades.length > 1 && new Set(cantidades).size > 1) {
      const min = cantidades.reduce((a, b) => (a < b ? a : b));
      const max = cantidades.reduce((a, b) => (a > b ? a : b));
      observaciones.push(
        `Las rondas se separan en ${formatear(max - min)} ${entrada.unidad}.`,
      );
    }

    if (esperado !== null && cantidades.length > 0) {
      const cercana = cantidades.reduce((a, b) => (abs(a - esperado) <= abs(b - esperado) ? a : b));
      observaciones.push(
        `La cifra más cercana al sistema se aparta ${formatear(abs(cercana - esperado))} ${entrada.unidad}.`,
      );
      if (esperado < 0n) {
        observaciones.push('El sistema central reportaba saldo NEGATIVO para este artículo.');
      }
    }

    if (entrada.saldoEsperado === null) {
      observaciones.push('El sistema central no tiene saldo esperado para este artículo.');
    }

    if (entrada.toleranciaAplicada === '0' || entrada.toleranciaAplicada === null) {
      observaciones.push('Se aplicó tolerancia cero: cualquier diferencia alerta.');
    }

    return Promise.resolve({
      proveedor: this.nombre,
      sintesis: {
        relato,
        observaciones,
        preguntas: PREGUNTAS[entrada.motivo] ?? PREGUNTAS['discrepancia']!,
        razonesPlausibles: RAZONES[entrada.motivo] ?? [],
      },
    });
  }
}

const formatear = (v: bigint): string =>
  (Number(v) / 10 ** ESCALA_CANTIDAD).toFixed(ESCALA_CANTIDAD).replace(/\.?0+$/, '');

/**
 * Preguntas por motivo. Son preguntas de verdad —cosas que solo se resuelven
 * en el estante— y no pistas disfrazadas hacia una respuesta.
 */
const PREGUNTAS: Record<string, readonly string[]> = {
  discrepancia: [
    '¿Hay producto de este artículo en otra ubicación de la bodega?',
    '¿Se registró alguna entrada o salida en el periodo que el sistema central no tenga?',
    '¿La unidad del catálogo corresponde a cómo se almacena físicamente?',
  ],
  contradiccion_entre_rondas: [
    '¿Las dos rondas recorrieron la misma ubicación física?',
    '¿Hubo movimiento del producto entre una ronda y la otra?',
    '¿Alguna de las dos contó envases y la otra contenido?',
  ],
  sin_cobertura: [
    '¿El artículo existe físicamente en esta bodega?',
    '¿Quedó fuera de la ruta de conteo o fue una omisión?',
  ],
  sin_saldo_esperado: [
    '¿El artículo es nuevo en el catálogo y aún no tiene saldo cargado?',
    '¿Corresponde a esta bodega o está mal asignado?',
  ],
  producto_fantasma: [
    '¿El producto corresponde a un artículo del catálogo con otro nombre?',
    '¿Llegó por traslado sin registrar?',
  ],
};

const RAZONES: Record<string, readonly string[]> = {
  discrepancia: ['MERMA', 'ERROR_CONTEO', 'NO_REGISTRADO', 'FALTANTE', 'SOBRANTE'],
  contradiccion_entre_rondas: ['ERROR_CONTEO'],
  sin_cobertura: ['ERROR_CONTEO', 'TRASLADO'],
  sin_saldo_esperado: ['ERROR_CATALOGO', 'NO_REGISTRADO'],
  producto_fantasma: ['ERROR_CATALOGO', 'TRASLADO', 'NO_REGISTRADO'],
};
