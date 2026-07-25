import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Traduce los errores que NO nacen en Nest.
 *
 * Los plugins de Fastify registrados antes que Nest —el límite de tasa, por
 * ejemplo— lanzan objetos planos con su propio `statusCode`. Nest, que solo
 * reconoce `HttpException`, los trata como fallo no controlado y responde 500.
 *
 * Y un 500 en un límite de tasa es peor que no tener límite: le dice al cliente
 * "el servidor está roto", así que el dispositivo lo toma por fallo transitorio
 * y REINTENTA — justo lo contrario de lo que el límite quiere provocar. Con 429
 * respalda y espera.
 *
 * Todo lo demás sigue el camino normal: este filtro solo interviene cuando el
 * objeto ya trae un código HTTP y un código de error de dominio.
 */
@Catch()
export class FiltroErrores extends BaseExceptionFilter {
  override catch(excepcion: unknown, host: ArgumentsHost): void {
    if (!(excepcion instanceof HttpException) && esErrorConEstado(excepcion)) {
      const { statusCode, ...cuerpo } = excepcion;
      super.catch(new HttpException(cuerpo, statusCode), host);
      return;
    }

    super.catch(excepcion, host);
  }
}

function esErrorConEstado(e: unknown): e is { statusCode: number; codigo: string } {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o['statusCode'] === 'number' && typeof o['codigo'] === 'string';
}
