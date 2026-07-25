import { type ArgumentMetadata, BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodTypeAny, type z } from 'zod';

/**
 * F-09 · Validación en TODA frontera de entrada (Principio VI).
 *
 * El tipo en compilación no protege del dato que llega de afuera. Son dos
 * validaciones distintas y ambas son necesarias: `tsc` cuida el código,
 * esto cuida el borde.
 *
 * El esquema viene de `@cci/contracts`, que es la fuente única (D-22). Nunca se
 * redefine aquí un tipo que ya existe allá.
 */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly esquema: T) {}

  transform(valor: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    try {
      return this.esquema.parse(valor) as z.infer<T>;
    } catch (e: unknown) {
      if (e instanceof ZodError) {
        // Se devuelve QUÉ campo y POR QUÉ. Un 422 sin detalle obliga a quien
        // integra a adivinar, y aquí quien integra es otro equipo.
        throw new BadRequestException({
          codigo: 'ENTRADA_INVALIDA',
          mensaje: 'La petición no cumple el contrato.',
          detalles: {
            errores: e.issues.map((i) => ({
              campo: i.path.join('.') || '(raíz)',
              motivo: i.message,
            })),
          },
        });
      }
      throw e;
    }
  }
}

/** Azúcar: `@Body(cuerpo(RegistroEntradaSchema))`. */
export const cuerpo = <T extends ZodTypeAny>(esquema: T): ZodPipe<T> => new ZodPipe(esquema);
