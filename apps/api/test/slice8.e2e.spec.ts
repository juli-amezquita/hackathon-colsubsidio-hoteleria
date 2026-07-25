import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Slice 8 — Historia 8: administración de tolerancias de merma.
 *
 * Poca funcionalidad y una consecuencia grande: la tolerancia decide cuándo el
 * sistema alerta, así que quien la mueve mueve el umbral de todo el control.
 *
 * Lo que de verdad hay que probar aquí no es que el panel guarde un número —eso
 * es un UPDATE—, sino las dos propiedades que lo hacen seguro: **que solo el
 * Administrador lo toque** y **que cambiarlo no reescriba el pasado**. Sin la
 * segunda, este panel sería la forma más fácil de hacer desaparecer una
 * discrepancia sin recontar nada.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

let ip = '';
let contador = 0;
beforeEach(() => {
  contador += 1;
  ip = `10.8.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 8 · administración de mermas', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookieOperador: string;
  let cookieAuditor: string;
  let cookieAdmin: string;
  let unidadPeso: string;
  let unidadNoPeso: string;

  const pedir = (cookie: string, opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: opciones.payload === undefined
        ? { cookie }
        : { cookie, 'content-type': 'application/json' },
      remoteAddress: ip,
    } as never);

  const entrar = async (documento: string): Promise<string> => {
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: documento, password: 'Inventario2026*' },
      remoteAddress: '10.8.0.0',
    } as never);
    const bruto = r.headers['set-cookie'];
    return (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  };

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 4, ssl: opcionesSsl(), onnotice: () => {} });

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await registrarSeguridad(app);
    app.useGlobalGuards(new SesionGuard(app.get(Reflector), app.get(SesionService)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    cookieOperador = await entrar('1000000001');
    cookieAuditor = await entrar('1000000002');
    cookieAdmin = await entrar('1000000003');

    // ⚠️ Unidades PROPIAS de esta suite.
    //
    // La tolerancia es global por unidad de medida: tocar la de `Kilogram`
    // cambiaría el resultado de las pruebas de los Slices 2 y 3, que corren en
    // paralelo contra la misma base. Con unidades propias, esta suite puede
    // subir y bajar la merma libremente sin afectar a nadie.
    unidadPeso = randomUUID();
    unidadNoPeso = randomUUID();
    await sql`
      INSERT INTO unidad_medida (id, codigo, nombre, es_peso) VALUES
        (${unidadPeso},   ${`H8-PESO-${unidadPeso.slice(0, 8)}`},   'Kilogramo de prueba H8', true),
        (${unidadNoPeso}, ${`H8-UNID-${unidadNoPeso.slice(0, 8)}`}, 'Unidad de prueba H8',    false)`;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  // ────────────────────────────────────────────────────────────────────

  describe('quién puede tocarlo (FR-8.1)', () => {
    it('solo el Administrador entra al panel; ni Operador ni Auditor', async () => {
      const rutas = [
        { method: 'GET', url: '/administracion/mermas' },
        { method: 'GET', url: '/administracion/mermas/historial' },
        { method: 'PUT', url: `/administracion/mermas/${unidadPeso}`, payload: { porcentaje: 0.9 } },
      ];

      for (const r of rutas) {
        // Un Operador con acceso a esto podría subir la merma hasta que su
        // propio conteo dejara de alertar.
        expect((await pedir(cookieOperador, r)).statusCode, `operador ${r.url}`).toBe(403);
        expect((await pedir(cookieAuditor, r)).statusCode, `auditor ${r.url}`).toBe(403);
      }

      expect((await pedir(cookieAdmin, { method: 'GET', url: '/administracion/mermas' })).statusCode).toBe(200);
    });

    it('el panel lista todas las unidades y dice a cuáles aplica', async () => {
      const { items } = (await pedir(cookieAdmin, { method: 'GET', url: '/administracion/mermas' }))
        .json<{ items: { unidad: string; esPeso: boolean; aplica: boolean }[] }>();

      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.aplica === i.esPeso)).toBe(true);
    });
  });

  describe('qué valores se aceptan (FR-8.4, H8-03)', () => {
    const fijar = (porcentaje: number, unidad = unidadPeso) =>
      pedir(cookieAdmin, { method: 'PUT', url: `/administracion/mermas/${unidad}`, payload: { porcentaje } });

    it('CERO es válido: significa que cualquier diferencia alerta', async () => {
      const r = await fijar(0);
      expect(r.statusCode).toBe(200);
      expect(Number(r.json<{ porcentaje: string }>().porcentaje)).toBe(0);
    });

    it('un valor negativo se rechaza', async () => {
      const r = await fijar(-0.01);
      expect(r.statusCode).toBe(400);
    });

    it('un valor desproporcionado se rechaza, y dice cuál es el techo', async () => {
      const r = await fijar(0.8);
      expect(r.statusCode).toBe(400);

      const e = r.json<{ codigo: string; mensaje: string }>();
      expect(e.codigo).toBe('TOLERANCIA_DESPROPORCIONADA');
      // Rechazarlo obliga a que apagar el control sea una decisión explícita.
      expect(e.mensaje).toMatch(/25%/);
    });

    it('fijarla en una unidad que no es de peso avisa que quedará inerte', async () => {
      const r = await fijar(0.05, unidadNoPeso);
      expect(r.statusCode).toBe(200);

      const cuerpo = r.json<{ aplica: boolean; advertencia: string | null }>();
      expect(cuerpo.aplica).toBe(false);
      // Aceptarlo en silencio dejaría al Administrador creyendo que hizo algo.
      expect(cuerpo.advertencia).toMatch(/no se mide por peso/i);
    });

    it('una unidad que no existe da 404', async () => {
      const r = await fijar(0.02, randomUUID());
      expect(r.statusCode).toBe(404);
    });
  });

  describe('el rastro del cambio (FR-8.3, FR-8.5, SC-8.1)', () => {
    it('cada cambio queda con autor y momento', async () => {
      await pedir(cookieAdmin, {
        method: 'PUT', url: `/administracion/mermas/${unidadPeso}`, payload: { porcentaje: 0.0123 },
      });

      const { items } = (await pedir(cookieAdmin, {
        method: 'GET', url: `/administracion/mermas/historial?unidadId=${unidadPeso}`,
      })).json<{ items: { porcentaje: string; usuario: string; cambiadoEn: string }[] }>();

      expect(Number(items[0]!.porcentaje)).toBe(0.0123);
      expect(items[0]!.usuario).toBe('Administrador de Prueba');
      expect(new Date(items[0]!.cambiadoEn).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('el historial conserva los valores anteriores, no solo el último', async () => {
      for (const p of [0.01, 0.02, 0.03]) {
        await pedir(cookieAdmin, {
          method: 'PUT', url: `/administracion/mermas/${unidadPeso}`, payload: { porcentaje: p },
        });
      }

      const { items } = (await pedir(cookieAdmin, {
        method: 'GET', url: `/administracion/mermas/historial?unidadId=${unidadPeso}`,
      })).json<{ items: { porcentaje: string }[] }>();

      // Más reciente primero.
      expect(items.slice(0, 3).map((i) => Number(i.porcentaje))).toEqual([0.03, 0.02, 0.01]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // La prueba que da sentido a la historia
  // ────────────────────────────────────────────────────────────────────

  describe('el cambio se aplica hacia adelante y NUNCA hacia atrás (FR-8.2, SC-8.2)', () => {
    const bodegaConPeso = async (saldo: string) => {
      const id = randomUUID();
      await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`H8-${id.slice(0, 8)}`}, 'Bodega H8')`;
      await sql`
        INSERT INTO usuario_bodega (usuario_id, bodega_id)
        SELECT id, ${id} FROM usuario WHERE documento = '1000000001'`;

      const articuloId = randomUUID();
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
        VALUES (${articuloId}, ${id}, 'CARNE MOLIDA H8', 'carne molida h8', ${unidadPeso})`;
      await sql`
        INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
        VALUES (${id}, ${articuloId}, ${saldo}, ${unidadPeso})`;

      return { bodegaId: id, articuloId };
    };

    const contar = async (bodega: string, articuloId: string, cantidad: number) => {
      const abrir = await pedir(cookieOperador, { method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
      const rondaId = abrir.json<{ rondaId: string }>().rondaId;

      const r = await pedir(cookieOperador, {
        method: 'POST',
        url: `/rondas/${rondaId}/registros`,
        payload: {
          articuloId, cantidad, unidadId: unidadPeso, estado: 'contado',
          modoCaptura: 'texto', origenParse: 'manual', origenNombre: 'exacto',
          capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
        },
      });
      return r.json<{ registroId: string; validacion: { resultado: string } }>();
    };

    const fijar = (porcentaje: number) =>
      pedir(cookieAdmin, { method: 'PUT', url: `/administracion/mermas/${unidadPeso}`, payload: { porcentaje } });

    it('subir la tolerancia hace que un conteo que antes alertaba ya no alerte', async () => {
      // 90 contra 100 es una diferencia del 10%.
      await fijar(0.02);
      const { bodegaId: b1, articuloId: a1 } = await bodegaConPeso('100.000');
      expect((await contar(b1, a1, 90)).validacion.resultado).toBe('alerta_discrepancia');

      await fijar(0.15);
      const { bodegaId: b2, articuloId: a2 } = await bodegaConPeso('100.000');
      expect((await contar(b2, a2, 90)).validacion.resultado).toBe('aceptado');
    });

    it('bajarla hace que un conteo que antes pasaba ahora alerte', async () => {
      await fijar(0.15);
      const { bodegaId: b1, articuloId: a1 } = await bodegaConPeso('100.000');
      expect((await contar(b1, a1, 90)).validacion.resultado).toBe('aceptado');

      await fijar(0);
      const { bodegaId: b2, articuloId: a2 } = await bodegaConPeso('100.000');
      expect((await contar(b2, a2, 90)).validacion.resultado).toBe('alerta_discrepancia');
    });

    it('⭐ un conteo YA registrado no cambia de resultado (SC-8.2)', async () => {
      await fijar(0.02);
      const { bodegaId: b, articuloId: a } = await bodegaConPeso('100.000');
      const registro = await contar(b, a, 90);
      expect(registro.validacion.resultado).toBe('alerta_discrepancia');

      // El Administrador sube la merma hasta que 90 contra 100 cabría.
      await fijar(0.15);

      const [fila] = await sql<{ resultado_validacion: string; tolerancia_aplicada: string }[]>`
        SELECT resultado_validacion, tolerancia_aplicada FROM registro_conteo
        WHERE id = ${registro.registroId}`;

      // Si esto cambiara, el panel sería la forma más fácil de hacer
      // desaparecer una discrepancia sin recontar nada.
      expect(fila!.resultado_validacion).toBe('alerta_discrepancia');
      expect(Number(fila!.tolerancia_aplicada)).toBe(0.02);
    });

    it('el cambio se ve de inmediato: la caché se invalida, no se espera al TTL', async () => {
      // Sin invalidación explícita esto tardaría hasta 15 minutos, y un
      // Administrador que no ve efecto concluye que el panel no sirve.
      await fijar(0);
      const { bodegaId: b1, articuloId: a1 } = await bodegaConPeso('50.000');
      expect((await contar(b1, a1, 49)).validacion.resultado).toBe('alerta_discrepancia');

      await fijar(0.05);
      const { bodegaId: b2, articuloId: a2 } = await bodegaConPeso('50.000');
      expect((await contar(b2, a2, 49)).validacion.resultado).toBe('aceptado');
    });
  });
});
