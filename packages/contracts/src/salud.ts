import { z } from 'zod';

/** Contrato de `GET /salud`. Entregable verificable de S-04. */
export const SaludSchema = z.object({
  estado: z.enum(['ok', 'degradado']),
  version: z.string(),
  momento: z.string().datetime({ offset: true }),
  dependencias: z.object({
    postgres: z.enum(['ok', 'caida', 'no_configurada']),
    redis: z.enum(['ok', 'caida', 'no_configurada']),
  }),
});
export type Salud = z.infer<typeof SaludSchema>;
