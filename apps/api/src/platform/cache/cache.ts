import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { redis } from '../redis/cliente';

/**
 * F-31 · Caché de aplicación en Redis (D-18).
 *
 * **NUNCA caché en memoria del proceso.** Con varias réplicas, cada una tendría
 * su propia versión de la tolerancia vigente, y dos operarios contando el mismo
 * artículo obtendrían veredictos distintos según a qué instancia cayeron. Eso
 * además rompe el despliegue stateless, que es la propiedad que D-07-A nos
 * permitió conservar.
 *
 * ⚠️ El saldo esperado se cachea **aquí, en el servidor**, y jamás se sirve al
 * cliente del Operador (FR-1.18). Que esté en caché es una optimización de
 * lectura; que no salga es la garantía del conteo ciego.
 */

/** Claves con prefijo y TTL declarados juntos: no hay TTL implícito. */
export const CLAVES = {
  catalogo: (bodegaId: string) => ({ clave: `cci:cat:${bodegaId}`, ttl: 900 }),
  saldos: (bodegaId: string) => ({ clave: `cci:sal:${bodegaId}`, ttl: 900 }),
  tolerancias: () => ({ clave: 'cci:tol', ttl: 900 }),
} as const;

@Injectable()
export class Cache {
  private get r(): Redis {
    return redis();
  }

  /**
   * Lee de caché o calcula y guarda.
   *
   * Si Redis falla, **calcula igual**. Un fallo de caché es un problema de
   * rendimiento; convertirlo en un fallo de servicio dejaría al operario sin
   * poder contar por algo que no afecta la corrección (Restricción 5).
   */
  async obtener<T>(
    entrada: { clave: string; ttl: number },
    calcular: () => Promise<T>,
  ): Promise<T> {
    try {
      const crudo = await this.r.get(entrada.clave);
      if (crudo !== null) return JSON.parse(crudo) as T;
    } catch {
      /* caché caída: se sigue por Postgres */
    }

    const valor = await calcular();

    try {
      await this.r.set(entrada.clave, JSON.stringify(valor), 'EX', entrada.ttl);
    } catch {
      /* no poder guardar no invalida lo que ya se calculó */
    }

    return valor;
  }

  /**
   * Invalidación explícita al cambiar configuración.
   *
   * El TTL de 15 min es la red de seguridad, no el mecanismo: una tolerancia
   * modificada por el Administrador tiene que verse ya. Y aun si esta
   * invalidación se pierde, FR-8.2 exige aplicar la tolerancia **vigente al
   * momento del conteo**, que se resuelve y se persiste con el registro — así
   * que una caché rancia nunca cambia el resultado de un conteo pasado.
   */
  async invalidar(clave: string): Promise<void> {
    try {
      await this.r.del(clave);
    } catch {
      /* el TTL la barrerá */
    }
  }

  /** Diagnóstico de F-32: tasa de acierto por debajo del 80% es señal. */
  async estadisticas(): Promise<{ aciertos: number; fallos: number } | null> {
    try {
      const info = await this.r.info('stats');
      const leer = (campo: string): number =>
        Number(new RegExp(`${campo}:(\\d+)`).exec(info)?.[1] ?? 0);
      return { aciertos: leer('keyspace_hits'), fallos: leer('keyspace_misses') };
    } catch {
      return null;
    }
  }
}
