import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SaludSchema } from '@cci/contracts';

import { AppModule } from '../src/app.module';

describe('GET /salud', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde y cumple el contrato, aunque las dependencias estén caídas', async () => {
    const res = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/salud' });

    expect(res.statusCode).toBe(200);
    // El contrato se valida contra el esquema, no contra lo que devolvió el código:
    // así el test falla si el contrato y la implementación se separan (Principio VI).
    expect(() => SaludSchema.parse(res.json())).not.toThrow();
  });
});
