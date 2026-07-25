import { Controller, Get } from '@nestjs/common';

import { Publico } from '../autorizacion/decoradores';
import type { Salud } from '@cci/contracts';

import { conexion } from '../db/cliente';
import { redis } from '../redis/cliente';

/** Entregable verificable de S-04: `GET /salud` responde. */
// La sonda de salud es de las dos únicas rutas públicas (la otra es el login).
@Controller('salud')
export class SaludController {
  @Get()
  @Publico()
  async estado(): Promise<Salud> {
    const [postgres, cache] = await Promise.all([this.probarPostgres(), this.probarRedis()]);

    return {
      estado: postgres === 'ok' ? 'ok' : 'degradado',
      version: process.env['npm_package_version'] ?? '0.1.0',
      momento: new Date().toISOString(),
      dependencias: { postgres, redis: cache },
    };
  }

  private async probarPostgres(): Promise<Salud['dependencias']['postgres']> {
    try {
      await conexion()`select 1`;
      return 'ok';
    } catch {
      return 'caida';
    }
  }

  // Redis caído degrada el rendimiento, no la corrección: la API va a Postgres.
  private async probarRedis(): Promise<Salud['dependencias']['redis']> {
    try {
      await redis().ping();
      return 'ok';
    } catch {
      return 'caida';
    }
  }
}
