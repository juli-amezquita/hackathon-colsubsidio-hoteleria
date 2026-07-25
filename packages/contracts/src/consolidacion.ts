import { z } from 'zod';

import { EstadoRegistroSchema, IdSchema, MomentoSchema } from './comun';

export const ClasificacionSchema = z.enum(['conciliado', 'auditable']);
export type Clasificacion = z.infer<typeof ClasificacionSchema>;

export const MotivoAuditableSchema = z.enum([
  'discrepancia',
  'contradiccion_entre_rondas',
  'sin_cobertura',
  'sin_saldo_esperado',
  'producto_fantasma',
]);
export type MotivoAuditable = z.infer<typeof MotivoAuditableSchema>;

export const OrigenValorSchema = z.enum(['conteo_ciego', 'auditor']);
export type OrigenValor = z.infer<typeof OrigenValorSchema>;

/** Lo que registró UNA ronda. Nunca fusionado ni recalculado (FR-3.8). */
export const DetalleRondaSchema = z.object({
  rondaId: IdSchema,
  operadorNombre: z.string(),
  estado: EstadoRegistroSchema,
  cantidad: z.number().nullable(),
  capturadoEn: MomentoSchema,
});
export type DetalleRonda = z.infer<typeof DetalleRondaSchema>;

export const ArticuloConsolidadoSchema = z.object({
  articuloId: IdSchema,
  nombre: z.string(),
  clasificacion: ClasificacionSchema,
  motivoAuditable: MotivoAuditableSchema.nullable(),
  valorFinal: z.number().nullable(),
  origenValor: OrigenValorSchema.nullable(),
  /** Informativo: una sola ronda basta para conciliar (D5). */
  rondasAfirmando: z.number().int(),
  rondas: z.array(DetalleRondaSchema),
});
export type ArticuloConsolidado = z.infer<typeof ArticuloConsolidadoSchema>;

/**
 * Lo que ve el Auditor, y solo el Auditor.
 *
 * Aquí SÍ viaja la diferencia contra el sistema (FR-4.2): el Auditor pertenece a
 * un equipo independiente de quien contó, no cuenta sino que verifica, y de su
 * lado no hay conflicto de interés que proteger con ceguera (D5).
 *
 * Que este tipo sea distinto de `ArticuloConsolidado` es deliberado: hace
 * imposible devolverle por descuido a un Operador la respuesta del Auditor.
 */
export const ItemAuditableSchema = ArticuloConsolidadoSchema.extend({
  diferenciaContraSistema: z.number().nullable(),
  /** Evidencia ordenada por el Árbitro. NO decide quién tiene razón (FR-3.4). */
  resumenArbitro: z.string().nullable(),
});
export type ItemAuditable = z.infer<typeof ItemAuditableSchema>;

export const ReconteoEntradaSchema = z.object({
  cantidad: z.number().min(0),
  unidadId: IdSchema,
  /** De un catálogo controlado. Sin causa no se cierra nada (R4, FR-4.4). */
  codigoRazonId: z.string().min(1),
  modoCaptura: z.enum(['voz', 'texto']),
  capturadoEn: MomentoSchema,
  claveIdempotencia: IdSchema,
});
export type ReconteoEntrada = z.infer<typeof ReconteoEntradaSchema>;
