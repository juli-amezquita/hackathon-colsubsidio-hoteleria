import { z } from 'zod';

import { EstadoRegistroSchema, IdSchema, ModoCapturaSchema, MomentoSchema } from './comun';
import { MotivoAuditableSchema } from './consolidacion';

/**
 * Contrato de eventos de dominio (contracts/events.md, Principio IV).
 *
 * REGLA NO NEGOCIABLE: el evento y el dato que lo origina se escriben en la
 * MISMA transacción. Un consumidor que recibe dos veces el mismo evento produce
 * UN efecto.
 */

export const TipoEventoSchema = z.enum([
  'ConteoRegistrado',
  'DiscrepanciaDetectada',
  'ProductoFantasmaRegistrado',
  'RondaCerrada',
  'ArticuloConciliado',
  'ReconteoRegistrado',
  'InventarioCerrado',
  'InventarioExportado',
]);
export type TipoEvento = z.infer<typeof TipoEventoSchema>;

/** Sobre común de todo evento. `eventId` es la clave de idempotencia del consumidor. */
export const SobreEventoSchema = z.object({
  eventId: IdSchema,
  tipo: TipoEventoSchema,
  /** Aditivo: añadir un campo NO la incrementa; cambiar el significado de uno, sí. */
  version: z.number().int().positive().default(1),
  ocurridoEn: MomentoSchema,
  actorId: IdSchema.nullable(),
});
export type SobreEvento = z.infer<typeof SobreEventoSchema>;

export const PAYLOADS = {
  ConteoRegistrado: z.object({
    rondaId: IdSchema,
    bodegaId: IdSchema,
    articuloId: IdSchema,
    secuencia: z.number().int(),
    estado: EstadoRegistroSchema,
    cantidad: z.number().nullable(),
    unidadId: IdSchema.nullable(),
    modoCaptura: ModoCapturaSchema,
  }),

  DiscrepanciaDetectada: z.object({
    bodegaId: IdSchema,
    articuloId: IdSchema.nullable(),
    motivo: MotivoAuditableSchema,
    rondasImplicadas: z.array(IdSchema),
  }),

  ProductoFantasmaRegistrado: z.object({
    rondaId: IdSchema,
    bodegaId: IdSchema,
    fantasmaId: IdSchema,
    descripcion: z.string(),
    unidadObservada: z.string(),
    cantidad: z.number(),
  }),

  RondaCerrada: z.object({
    rondaId: IdSchema,
    bodegaId: IdSchema,
    operadorId: IdSchema,
    articulosResueltos: z.number().int(),
  }),

  ArticuloConciliado: z.object({
    bodegaId: IdSchema,
    articuloId: IdSchema,
    valorFinal: z.number(),
    rondasAfirmando: z.number().int(),
    toleranciaAplicada: z.number().nullable(),
  }),

  ReconteoRegistrado: z.object({
    bodegaId: IdSchema,
    articuloId: IdSchema.nullable(),
    fantasmaId: IdSchema.nullable(),
    cantidad: z.number(),
    codigoRazonId: z.string(),
    auditorId: IdSchema,
  }),

  InventarioCerrado: z.object({
    bodegaId: IdSchema,
    hashConsolidado: z.string(),
    cerradoPor: IdSchema,
  }),

  InventarioExportado: z.object({
    bodegaId: IdSchema,
    formato: z.enum(['csv', 'xlsx', 'erp']),
    referenciaEnvio: z.string(),
  }),
} as const;

export type PayloadDe<T extends TipoEvento> = z.infer<(typeof PAYLOADS)[T]>;

/** Evento completo, tipado por su tipo. */
export type Evento<T extends TipoEvento = TipoEvento> = SobreEvento & {
  tipo: T;
  payload: PayloadDe<T>;
};

/**
 * Valida el sobre y el payload juntos. Un evento con payload que no corresponde
 * a su tipo no entra al outbox: llegaría al consumidor y fallaría allá, lejos
 * de donde se puede arreglar.
 */
export function validarEvento(crudo: unknown): Evento {
  const sobre = SobreEventoSchema.extend({ payload: z.unknown() }).parse(crudo);
  const payload = PAYLOADS[sobre.tipo].parse(sobre.payload);
  return { ...sobre, payload };
}
