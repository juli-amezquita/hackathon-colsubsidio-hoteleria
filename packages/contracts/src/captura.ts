import { z } from 'zod';

import {
  ClaveIdempotenciaSchema,
  EstadoRegistroSchema,
  IdSchema,
  ModoCapturaSchema,
  MomentoSchema,
  OrigenNombreSchema,
} from './comun';
import { UnidadSchema } from './catalogo';

export const OrigenParseSchema = z.enum(['gramatica', 'modelo', 'manual']);
export type OrigenParse = z.infer<typeof OrigenParseSchema>;

export const RondaSchema = z.object({
  rondaId: IdSchema,
  bodegaId: IdSchema,
  operadorNombre: z.string(),
  abiertaEn: MomentoSchema,
  cerrada: z.boolean(),
});
export type Ronda = z.infer<typeof RondaSchema>;

/**
 * Lo que el dispositivo envía por cada conteo.
 *
 * La cantidad es obligatoria salvo en `no_contado`, que es ausencia de
 * afirmación y no una cantidad (FR-3.9). El refinamiento lo impone aquí, en el
 * contrato, además de en la base: una entrada inconsistente ni siquiera llega
 * al dominio.
 */
export const RegistroEntradaSchema = z
  .object({
    articuloId: IdSchema,
    estado: EstadoRegistroSchema,
    cantidad: z.number().min(0).nullable(),
    unidadId: IdSchema.nullable(),
    modoCaptura: ModoCapturaSchema,
    origenParse: OrigenParseSchema,
    origenNombre: OrigenNombreSchema.nullable(),

    /** Reloj del cliente anclado a la referencia del servidor (D-16). */
    capturadoEn: MomentoSchema,

    /** Generada en el dispositivo ANTES de intentar el envío (R2, FR-6.2). */
    claveIdempotencia: ClaveIdempotenciaSchema,

    /** Requerido si el artículo ya fue contado en esta ronda (FR-1.14). */
    confirmaCorreccion: z.boolean().default(false),

    /** El usuario confirma pese a una alerta de discrepancia (FR-2.4). */
    confirmaPeseAAlerta: z.boolean().default(false),
  })
  .refine((r) => (r.estado === 'no_contado' ? r.cantidad === null : r.cantidad !== null), {
    message: 'La cantidad es obligatoria salvo en `no_contado`, donde debe ser nula.',
    path: ['cantidad'],
  })
  .refine((r) => (r.estado === 'no_contado' ? r.unidadId === null : r.unidadId !== null), {
    message: 'La unidad es obligatoria salvo en `no_contado`.',
    path: ['unidadId'],
  });
export type RegistroEntrada = z.infer<typeof RegistroEntradaSchema>;

export const RegistroAceptadoSchema = z.object({
  registroId: IdSchema,
  secuencia: z.number().int(),
  /** Sello autoritativo del servidor (D-16). */
  recibidoEn: MomentoSchema,
});
export type RegistroAceptado = z.infer<typeof RegistroAceptadoSchema>;

/**
 * Resultado de la validación en servidor.
 *
 * ⚠️ Para rol Operador NUNCA incluye el saldo esperado, ni la diferencia, ni la
 * tolerancia — solo SI hay alerta y de qué tipo (FR-2.2). La alerta es una
 * pregunta para que el operario verifique lo que él mismo dijo, no una pista
 * que lo acerque a la cifra del sistema.
 */
export const ResultadoValidacionSchema = z.object({
  registroId: IdSchema,
  resultado: z.enum(['aceptado', 'alerta_unidad', 'alerta_discrepancia', 'no_validable']),
  /** Presente solo en `alerta_unidad` (FR-2.1). */
  unidadCorrecta: UnidadSchema.nullable(),
  exigeEvidencia: z.boolean(),
});
export type ResultadoValidacion = z.infer<typeof ResultadoValidacionSchema>;

/**
 * Cuadre de cierre: por cada artículo no registrado, el Operador decide entre
 * *contado en cero* y *no contado* (FR-1.15). Son distintos y se conservan por
 * separado para siempre (FR-1.16).
 */
export const DecisionCierreSchema = z.object({
  articuloId: IdSchema,
  estado: z.enum(['contado_en_cero', 'no_contado']),
  claveIdempotencia: ClaveIdempotenciaSchema,
});
export type DecisionCierre = z.infer<typeof DecisionCierreSchema>;

export const CierreRondaSchema = z.object({
  decisiones: z.array(DecisionCierreSchema),
});
export type CierreRonda = z.infer<typeof CierreRondaSchema>;

/** Hallazgo físico sin correspondencia en el catálogo (FR-5.x). */
export const ProductoFantasmaEntradaSchema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(20, 'La descripción debe ser detallada, no un nombre genérico (FR-5.2).'),
  unidadObservada: z.string().min(1),
  cantidad: z.number().min(0),
  modoCaptura: ModoCapturaSchema,
  capturadoEn: MomentoSchema,
  claveIdempotencia: ClaveIdempotenciaSchema,
});
export type ProductoFantasmaEntrada = z.infer<typeof ProductoFantasmaEntradaSchema>;
