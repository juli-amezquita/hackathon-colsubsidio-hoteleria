import { z } from 'zod';

import { IdSchema, OrigenNombreSchema } from './comun';

export const UnidadSchema = z.object({
  id: IdSchema,
  nombre: z.string(),
  /** Decide si aplica tolerancia de merma (FR-2.3). */
  esPeso: z.boolean(),
});
export type Unidad = z.infer<typeof UnidadSchema>;

/**
 * Artículo tal como lo ve el Operador.
 *
 * Deliberadamente NO contiene saldo esperado, ni tolerancia, ni conteos previos
 * de otras rondas (FR-1.18). Que este tipo sea pobre es el punto: si algún día
 * alguien le añade el saldo "porque es cómodo", el conteo deja de ser ciego.
 */
export const ArticuloDeTrabajoSchema = z.object({
  articuloId: IdSchema,
  nombre: z.string(),
  codigo: z.string().nullable(),
  unidadEsperada: UnidadSchema,
});
export type ArticuloDeTrabajo = z.infer<typeof ArticuloDeTrabajoSchema>;

/** Lo que el Operador dictó, tal cual salió de la transcripción. */
export const ResolucionEntradaSchema = z.object({
  textoDictado: z.string().min(1).max(200),
});
export type ResolucionEntrada = z.infer<typeof ResolucionEntradaSchema>;

export const CandidatoSchema = z.object({
  articulo: ArticuloDeTrabajoSchema,
  puntaje: z.number().min(0).max(1),
});
export type Candidato = z.infer<typeof CandidatoSchema>;

/**
 * Resultado de resolver el nombre contra el catálogo (D-05, D-19).
 *
 * `resuelto` solo cuando el mejor candidato supera el umbral de aceptación **y**
 * le saca margen suficiente al segundo. En cualquier otro caso llegan candidatos
 * y decide la persona: el sistema NUNCA elige en caso de duda (FR-1.11, FR-1.27).
 */
export const ResolucionArticuloSchema = z.object({
  estado: z.enum(['resuelto', 'candidatos', 'sin_coincidencia']),
  articulo: ArticuloDeTrabajoSchema.nullable(),
  origenNombre: OrigenNombreSchema.nullable(),
  candidatos: z.array(CandidatoSchema),
});
export type ResolucionArticulo = z.infer<typeof ResolucionArticuloSchema>;
