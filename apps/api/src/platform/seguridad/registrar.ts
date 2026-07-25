import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { HttpAdapterHost } from '@nestjs/core';

import { config } from '../../config';
import { redis } from '../redis/cliente';
import { FiltroErrores } from './filtro-errores';

/**
 * F-16 · Postura de seguridad HTTP (OWASP A01/A05).
 *
 * Todo se registra en un solo sitio: repartir cabeceras entre módulos es como
 * se termina con una ruta sin CSP que nadie recuerda haber creado.
 */
export async function registrarSeguridad(app: NestFastifyApplication): Promise<void> {
  const c = config();
  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(cookie, { secret: c.SESSION_SECRET });

  await fastify.register(helmet, {
    // Esta API no sirve HTML. La CSP es de cinturón: si algún día devolviera
    // una página por error, no podría ejecutar nada.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // CloudFront termina TLS delante; esto le dice al navegador que no vuelva
    // a intentar por HTTP.
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  /**
   * Límite de tasa CON REDIS, no en memoria del proceso.
   *
   * En memoria, cada réplica llevaría su propio conteo y el límite real sería
   * el configurado multiplicado por el número de instancias — es decir, no
   * habría límite. Además rompería la propiedad de despliegue stateless.
   */
  await fastify.register(rateLimit, {
    global: true,
    max: 300, // por minuto: un operario genera ~4/min, hay margen de sobra
    timeWindow: '1 minute',
    redis: redis(),
    nameSpace: 'cci:rl:',
    keyGenerator: (req) => req.ip,
    // Si Redis se cae, la API sigue atendiendo. Perder el límite es peor que
    // perder el servicio, pero mucho menos peor (Restricción 5).
    skipOnError: true,
    // ⚠️ El `statusCode` es obligatorio aquí. Sin él, Nest recibe un objeto que
    // no es `HttpException`, lo trata como fallo no controlado y responde 500 —
    // y un 500 le dice al cliente "el servidor está roto, reintenta", que es
    // exactamente lo contrario de lo que un límite de tasa quiere provocar.
    // Con 429 el dispositivo respalda y espera, que es lo correcto.
    errorResponseBuilder: () => ({
      statusCode: 429,
      codigo: 'DEMASIADAS_PETICIONES',
      mensaje: 'Demasiadas peticiones. Intente de nuevo en un momento.',
    }),
  });

  /**
   * El login lleva su propio límite, mucho más estricto: es donde se prueba
   * un diccionario de contraseñas (OWASP A07).
   */
  fastify.addHook('onRoute', (ruta) => {
    if (ruta.url === '/sesion' && ruta.method === 'POST') {
      ruta.config = {
        ...(ruta.config ?? {}),
        rateLimit: { max: 10, timeWindow: '5 minutes' },
      };
    }
  });

  // Traduce los errores de los plugins de Fastify, que no son HttpException y
  // sin esto saldrían como 500. Ver `filtro-errores.ts`.
  app.useGlobalFilters(new FiltroErrores(app.get(HttpAdapterHost).httpAdapter));

  // CORS cerrado: solo el origen del frontend, y con credenciales porque la
  // sesión viaja en cookie.
  app.enableCors({
    origin: c.API_CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
}
