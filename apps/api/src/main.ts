import 'reflect-metadata';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { config } from './config';
import { SesionService } from './modules/identidad/sesion.service';
import { SesionGuard } from './platform/autorizacion/sesion.guard';
import { cerrarConexion } from './platform/db/cliente';
import { REDACCION_PINO } from './platform/logs/redaccion';
import { cerrarRedis } from './platform/redis/cliente';
import { registrarSeguridad } from './platform/seguridad/registrar';
import { detenerTelemetria, iniciarTelemetria } from './platform/telemetria';

async function arrancar(): Promise<void> {
  iniciarTelemetria(); // antes que nada, para instrumentar el resto

  const c = config();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // La redacción se configura en el logger, no se confía a que nadie
      // registre una cookie por descuido (F-17, NFR-005).
      logger: c.NODE_ENV === 'test' ? false : { redact: REDACCION_PINO },
      trustProxy: true, // CloudFront va delante: el IP real llega en X-Forwarded-For
    }),
  );

  await registrarSeguridad(app);

  // Guarda GLOBAL: sin @Roles ni @Publico, una ruta no la puede usar nadie.
  // Registrarla aquí y no ruta por ruta es lo que hace que el olvido sea seguro.
  app.useGlobalGuards(new SesionGuard(app.get(Reflector), app.get(SesionService)));

  // El proceso es stateless: cualquier réplica atiende cualquier petición y un
  // despliegue es un reemplazo, sin draining ni sticky sessions.
  await app.listen({ port: c.API_PORT, host: '0.0.0.0' });

  for (const senal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(senal, () => {
      void (async () => {
        await app.close();
        await Promise.all([cerrarConexion(), cerrarRedis(), detenerTelemetria()]);
        process.exit(0);
      })();
    });
  }
}

void arrancar();
