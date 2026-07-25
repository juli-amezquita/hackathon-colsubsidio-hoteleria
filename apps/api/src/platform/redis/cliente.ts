import Redis from 'ioredis';

import { config } from '../../config';

/**
 * Redis como caché de aplicación (D-18): catálogo por bodega, saldos esperados,
 * tolerancias vigentes y límites de tasa.
 *
 * NUNCA caché en memoria del proceso: con varias réplicas cada una tendría una
 * versión distinta de la tolerancia vigente, y eso rompe el despliegue stateless.
 *
 * El saldo esperado se cachea EN EL SERVIDOR y jamás se sirve al cliente (FR-1.18).
 */

let cliente: Redis | undefined;

export function redis(): Redis {
  if (!cliente) {
    cliente = new Redis(config().REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      // Si Redis se cae, la API sigue: degrada a Postgres (Restricción 5).
      enableOfflineQueue: false,
    });
    cliente.on('error', () => {
      /* la salud del proceso no depende de la caché */
    });
  }
  return cliente;
}

export async function cerrarRedis(): Promise<void> {
  await cliente?.quit();
  cliente = undefined;
}
