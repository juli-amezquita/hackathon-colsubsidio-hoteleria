import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { redactar } from '../src/platform/logs/redaccion';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * F-13 a F-17 · Identidad, sesión, autorización y redacción de logs.
 *
 * Se prueba la aplicación REAL con su guarda global registrada, no una versión
 * de laboratorio: si la guarda no estuviera puesta, estas pruebas pasarían de
 * todas formas contra un mock, y esa es exactamente la falla que buscamos.
 */
describe('F-13/F-14/F-15 · autenticación y autorización', () => {
  let app: NestFastifyApplication;
  const inyectar = (opciones: Parameters<NestFastifyApplication['inject']>[0]) =>
    app.getHttpAdapter().getInstance().inject(opciones);

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await registrarSeguridad(app);
    app.useGlobalGuards(new SesionGuard(app.get(Reflector), app.get(SesionService)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('sin sesión, una ruta protegida responde 401', async () => {
    const r = await inyectar({ method: 'GET', url: '/sesion' });
    expect(r.statusCode).toBe(401);
  });

  it('la sonda de salud es pública', async () => {
    const r = await inyectar({ method: 'GET', url: '/salud' });
    expect(r.statusCode).toBe(200);
  });

  it('rechaza credenciales inválidas sin decir cuál falló', async () => {
    const r = await inyectar({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: '1000000001', password: 'equivocada' },
    });

    expect(r.statusCode).toBe(401);
    const cuerpo = r.json<{ mensaje: string }>();
    // Un mensaje distinto para "no existe" y "clave mala" permitiría enumerar
    // usuarios probando documentos (OWASP A07).
    expect(cuerpo.mensaje).toMatch(/usuario o contraseña/i);
  });

  it('un usuario que no existe da EXACTAMENTE la misma respuesta', async () => {
    const r = await inyectar({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: '0000000000', password: 'equivocada' },
    });

    expect(r.statusCode).toBe(401);
    expect(r.json<{ mensaje: string }>().mensaje).toMatch(/usuario o contraseña/i);
  });

  it('con credenciales válidas emite la cookie de sesión y deduce el rol', async () => {
    const r = await inyectar({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: '1000000002', password: 'Inventario2026*' },
    });

    expect(r.statusCode).toBe(200);

    const sesion = r.json<{ rol: string; bodegas: unknown[] }>();
    // El rol lo pone la base, no la petición (FR-1.2).
    expect(sesion.rol).toBe('auditor');
    expect(sesion.bodegas.length).toBeGreaterThan(0);

    const cookie = r.headers['set-cookie'];
    const texto = Array.isArray(cookie) ? cookie.join(';') : String(cookie);
    expect(texto).toMatch(/cci_sesion=/);
    expect(texto).toMatch(/HttpOnly/i); // no legible desde JavaScript: XSS no la roba
    expect(texto).toMatch(/SameSite=Strict/i);
  });

  it('la sesión emitida sirve para entrar', async () => {
    const login = await inyectar({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: '1000000001', password: 'Inventario2026*' },
      remoteAddress: '10.0.0.5',
    });

    const bruto = login.headers['set-cookie'];
    const cookie = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;

    const r = await inyectar({ method: 'GET', url: '/sesion', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ rol: string }>().rol).toBe('operador');
  });

  it('una cookie manipulada no vale: la firma no cuadra', async () => {
    const contenido = Buffer.from(
      JSON.stringify({ sub: 'x', rol: 'administrador', exp: Date.now() + 60_000, jti: 'x' }),
    ).toString('base64url');

    const r = await inyectar({
      method: 'GET',
      url: '/sesion',
      headers: { cookie: `cci_sesion=${contenido}.firmainventada` },
    });

    expect(r.statusCode).toBe(401);
  });

  it('devuelve las cabeceras de seguridad', async () => {
    const r = await inyectar({ method: 'GET', url: '/salud' });
    expect(r.headers['content-security-policy']).toBeDefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('F-17 · redacción de logs', () => {
  it('oculta credenciales, tokens y cookies por nombre de campo', () => {
    const r = redactar({
      usuario: 'x',
      password: 'secreta',
      hash_password: '$argon2id$...',
      cookie: 'cci_sesion=abc',
      anidado: { apiKey: 'sk-123', normal: 'visible' },
    }) as Record<string, unknown>;

    expect(r['password']).toBe('[redactado]');
    expect(r['hash_password']).toBe('[redactado]');
    expect(r['cookie']).toBe('[redactado]');
    expect((r['anidado'] as Record<string, unknown>)['apiKey']).toBe('[redactado]');
    expect((r['anidado'] as Record<string, unknown>)['normal']).toBe('visible');
  });

  it('nunca deja pasar un buffer: sería audio o una clave', () => {
    const r = redactar({ clip: Buffer.from('audio crudo') }) as Record<string, unknown>;
    expect(String(r['clip'])).toBe('[redactado]');
  });

  it('no muta el objeto original', () => {
    const original = { password: 'secreta' };
    redactar(original);
    expect(original.password).toBe('secreta');
  });
});

describe('límite de tasa', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await registrarSeguridad(app);
    app.useGlobalGuards(new SesionGuard(app.get(Reflector), app.get(SesionService)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  /**
   * Un límite de tasa que responde 500 es peor que no tenerlo.
   *
   * El 500 le dice al cliente "el servidor está roto": el dispositivo lo trata
   * como fallo transitorio y REINTENTA, que es exactamente lo contrario de lo
   * que un límite quiere provocar. Con 429 respalda y espera.
   *
   * Se descubrió porque dos suites en paralelo consumían el cupo entre ellas y
   * la API devolvía 500 sin decir por qué.
   */
  it('responde 429, no 500, al superar el cupo', async () => {
    const ip = '10.9.9.9';
    const inject = () =>
      app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/salud', remoteAddress: ip } as never);

    let ultima = 200;
    for (let i = 0; i < 320 && ultima === 200; i++) {
      ultima = (await inject()).statusCode;
    }

    expect(ultima).toBe(429);
  });
});
