import { z } from 'zod';

/** Identificador de entidad. UUIDv7 en el cliente para el orden monótono (D-15). */
export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

/**
 * Clave de idempotencia generada en el dispositivo antes de intentar el envío
 * (Restricción 2, FR-6.2). El servidor deduplica por ella:
 * `INSERT … ON CONFLICT (clave_idempotencia) DO NOTHING`.
 */
export const ClaveIdempotenciaSchema = z.string().uuid();
export type ClaveIdempotencia = z.infer<typeof ClaveIdempotenciaSchema>;

/** Momento en ISO-8601 con zona. Nunca el reloj crudo del dispositivo (FR-6.8). */
export const MomentoSchema = z.string().datetime({ offset: true });
export type Momento = z.infer<typeof MomentoSchema>;

/** Cómo se capturó el dato. Es evidencia de auditoría, no telemetría (R3, FR-1.12). */
export const ModoCapturaSchema = z.enum(['voz', 'texto']);
export type ModoCaptura = z.infer<typeof ModoCapturaSchema>;

/** Cómo se resolvió el artículo dictado (D-05, D-19). */
export const OrigenNombreSchema = z.enum(['exacto', 'similitud', 'alias', 'seleccion_usuario']);
export type OrigenNombre = z.infer<typeof OrigenNombreSchema>;

/** Estado de un artículo dentro de una ronda. `contado_en_cero` ≠ `no_contado` (FR-1.16). */
export const EstadoRegistroSchema = z.enum(['contado', 'contado_en_cero', 'no_contado']);
export type EstadoRegistro = z.infer<typeof EstadoRegistroSchema>;

/** Roles. Se deducen de la base de datos; el usuario nunca los elige (FR-1.2). */
export const RolSchema = z.enum(['operador', 'auditor', 'administrador']);
export type Rol = z.infer<typeof RolSchema>;

/** Error uniforme de la API. Nunca transporta el saldo esperado (FR-1.18). */
export const ErrorApiSchema = z.object({
  codigo: z.string(),
  mensaje: z.string(),
  detalles: z.record(z.unknown()).optional(),
});
export type ErrorApi = z.infer<typeof ErrorApiSchema>;
