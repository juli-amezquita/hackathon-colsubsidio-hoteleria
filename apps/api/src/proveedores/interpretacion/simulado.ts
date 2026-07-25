import { Injectable } from '@nestjs/common';
import { parsear } from '@cci/gramatica';

import type {
  EntradaInterpretacion,
  ProveedorDeInterpretacion,
  ResultadoInterpretacion,
} from './proveedor';

/**
 * Adaptador simulado del intérprete.
 *
 * Reintenta con la gramática sobre el texto normalizado y, si aun así falla,
 * devuelve confianza cero — que en el sistema significa "pregúntale al
 * operario". Nunca inventa una propuesta.
 *
 * Permite ejercitar toda la ruta de excepción sin credenciales ni costo.
 */
@Injectable()
export class InterpretacionSimulada implements ProveedorDeInterpretacion {
  readonly nombre = 'simulado';

  interpretar(entrada: EntradaInterpretacion): Promise<ResultadoInterpretacion> {
    const r = parsear(entrada.textoDictado);

    const propuesta = r.ok
      ? {
          nombre: entrada.catalogo.find((c) => c.toLowerCase().includes(r.nombre)) ?? null,
          cantidad: r.cantidad,
          unidad: r.unidad,
          confianza: 0.9,
          nota: null,
        }
      : {
          nombre: null,
          cantidad: null,
          unidad: null,
          confianza: 0,
          nota: `Adaptador simulado: la gramática falló con motivo ${r.motivo}.`,
        };

    return Promise.resolve({
      propuesta,
      uso: { entrada: 0, salida: 0, escritosACache: 0, leidosDeCache: 0 },
    });
  }
}
