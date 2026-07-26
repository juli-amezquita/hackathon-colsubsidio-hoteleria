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

/**
 * H8-03 · El cambio de tolerancia (FR-8.4).
 *
 * Cero es explícitamente válido: significa que cualquier diferencia alerta. El
 * techo lo impone el servidor, que es donde vive la regla de qué es
 * desproporcionado.
 */
export const ToleranciaEntradaSchema = z.object({
  /** El techo real (0,2%) lo impone el servidor; aquí solo el rango del tipo. */
  porcentaje: z.number().min(0).max(1),
});
export type ToleranciaEntrada = z.infer<typeof ToleranciaEntradaSchema>;

/**
 * Una propuesta de alias que una persona aprobó.
 *
 * Se manda el alias YA normalizado tal como lo trae el reporte: aceptar texto
 * libre aquí abriría la puerta a que se guarde un alias que la resolución nunca
 * va a encontrar, porque busca contra la forma normalizada.
 */
export const AliasAprobadoSchema = z.object({
  bodegaId: IdSchema,
  articuloId: IdSchema,
  alias: z.string().trim().min(2),
});
export type AliasAprobado = z.infer<typeof AliasAprobadoSchema>;

/** La decisión sobre una propuesta de mejora. La nota es para el que venga. */
export const DecisionPropuestaSchema = z.object({
  aprobar: z.boolean(),
  nota: z.string().trim().max(500).optional(),
});
export type DecisionPropuesta = z.infer<typeof DecisionPropuestaSchema>;
