import { z } from 'zod';

import { IdSchema, RolSchema } from './comun';

export const CredencialesSchema = z.object({
  usuario: z.string().min(1),
  password: z.string().min(1),
});
export type Credenciales = z.infer<typeof CredencialesSchema>;

/**
 * El rol se DEDUCE de la base de datos; el usuario nunca lo elige (FR-1.2).
 *
 * Viaja al cliente solo para decidir qué pinta, jamás qué permite: la
 * autorización se resuelve siempre en el servidor y está negada por defecto.
 */
export const SesionSchema = z.object({
  usuarioId: IdSchema,
  nombre: z.string(),
  rol: RolSchema,
  bodegas: z.array(z.object({ id: IdSchema, nombre: z.string() })),
});
export type Sesion = z.infer<typeof SesionSchema>;

export const ToleranciaMermaSchema = z.object({
  unidadId: IdSchema,
  porcentaje: z.number().min(0).max(1),
  vigenteDesde: z.string().datetime({ offset: true }),
  modificadaPor: z.string().nullable(),
});
export type ToleranciaMerma = z.infer<typeof ToleranciaMermaSchema>;
