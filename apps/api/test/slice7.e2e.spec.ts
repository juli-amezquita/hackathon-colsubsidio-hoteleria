import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { AppModule } from '../src/app.module';
import { DespachadorService } from '../src/despacho/despacho.module';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Slice 7 — Historia 7: salida de datos e integración con el sistema central.
 *
 * Es el destino del dato y el punto donde se elimina la transcripción manual,
 * que era el origen del problema entero. Sin esto el sistema mejora el conteo
 * y deja intacta la causa raíz.
 *
 * Y es donde vive la última mitad de D8: la tabla madre se mueve AQUÍ, con el
 * aval del Auditor, y en ningún otro punto del sistema.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

/**
 * Una IP por prueba.
 *
 * El límite de tasa es de 300 peticiones por minuto y por IP — correcto para un
 * operario, que genera unas cuatro—. Una suite entera contra el mismo proceso
 * no es ese escenario: se agotaría el cupo a sí misma y las pruebas fallarían
 * por un 429 que en producción nadie vería. Cada prueba estrena IP, que además
 * es lo que pasa de verdad: son dispositivos distintos.
 */
let ip = '';
let contador = 0;
beforeEach(() => {
  contador += 1;
  ip = `10.7.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 7 · salida e integración', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookieOperador: string;
  let cookieAuditor: string;
  let cookieAdmin: string;
  let despachador: DespachadorService;
  let unidadId: string;

  /**
   * El `content-type: application/json` solo va cuando HAY cuerpo.
   *
   * Fastify rechaza con 400 una petición que declara JSON y no manda nada, y
   * hace bien: es una petición mal formada. `POST /cierre` y `POST /envio` no
   * llevan cuerpo, así que quien los llame no debe poner la cabecera —está
   * dicho en la entrega al frontend.
   */
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
      remoteAddress: '10.7.0.0',
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

    despachador = app.get(DespachadorService);
    cookieOperador = await entrar('1000000001');
    cookieAuditor = await entrar('1000000002');
    cookieAdmin = await entrar('1000000003');

    const [u] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;
    unidadId = u!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  const drenar = async (bodega: string): Promise<void> => {
    for (let i = 0; i < 40; i++) {
      await despachador.pasada();
      const [p] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM outbox
        WHERE despachado_en IS NULL AND payload->>'bodegaId' = ${bodega}`;
      if ((p?.n ?? 0) === 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`El evento de la bodega ${bodega} no se despachó a tiempo.`);
  };

  const bodegaCon = async (articulos: readonly { nombre: string; saldo: string; codigo?: string }[]) => {
    const id = randomUUID();
    await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`H7-${id.slice(0, 8)}`}, 'Bodega de prueba H7')`;
    await sql`
      INSERT INTO usuario_bodega (usuario_id, bodega_id)
      SELECT id, ${id} FROM usuario WHERE documento IN ('1000000001', '1000000002', '1000000003')`;

    const ids: string[] = [];
    for (const a of articulos) {
      const articuloId = randomUUID();
      ids.push(articuloId);
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id, codigo)
        VALUES (${articuloId}, ${id}, ${a.nombre}, ${a.nombre.toLowerCase()}, ${unidadId}, ${a.codigo ?? null})`;
      await sql`
        INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
        VALUES (${id}, ${articuloId}, ${a.saldo}, ${unidadId})`;
    }
    return { bodegaId: id, ids };
  };

  /** Ronda que cuenta lo indicado y marca el resto como no contado. */
  const contar = async (bodega: string, conteos: ReadonlyMap<string, number>) => {
    const abrir = await pedir(cookieOperador, { method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
    const rondaId = abrir.json<{ rondaId: string }>().rondaId;

    for (const [articuloId, cantidad] of conteos) {
      await pedir(cookieOperador, {
        method: 'POST',
        url: `/rondas/${rondaId}/registros`,
        payload: {
          articuloId, cantidad, unidadId, estado: 'contado',
          modoCaptura: 'texto', origenParse: 'manual', origenNombre: 'exacto',
          capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
          confirmaPeseAAlerta: true,
        },
      });
    }

    const cuadre = await pedir(cookieOperador, { method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
    await pedir(cookieOperador, {
      method: 'POST',
      url: `/rondas/${rondaId}/cierre`,
      payload: {
        decisiones: cuadre.json<{ pendientes: { articuloId: string }[] }>().pendientes.map((p) => ({
          articuloId: p.articuloId, estado: 'no_contado', claveIdempotencia: randomUUID(),
        })),
      },
    });
    await drenar(bodega);
  };

  const resolver = (bodega: string, articuloId: string, cantidad: number, razon = 'ERROR_CONTEO') =>
    pedir(cookieAuditor, {
      method: 'POST',
      url: `/auditoria/bodegas/${bodega}/articulos/${articuloId}/reconteo`,
      payload: {
        cantidad, unidadId, codigoRazonId: razon, modoCaptura: 'texto',
        capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
      },
    });

  /** Bodega lista para cerrar: un conciliado, un resuelto por el Auditor. */
  const bodegaAvalada = async () => {
    const { bodegaId: b, ids } = await bodegaCon([
      { nombre: 'ARROZ DIANA LIBRA', saldo: '40.000', codigo: '7001' },
      { nombre: 'PANELA CUADRADA', saldo: '25.000' },
    ]);

    await contar(b, new Map([[ids[0]!, 40], [ids[1]!, 9]]));
    await resolver(b, ids[1]!, 23, 'MERMA');
    return { bodegaId: b, ids };
  };

  // ────────────────────────────────────────────────────────────────────

  describe('el consolidado que sale (H7-02, FR-7.7)', () => {
    it('cada artículo dice valor final, origen y causa', async () => {
      const { bodegaId: b } = await bodegaAvalada();

      const { items } = (await pedir(cookieAuditor, {
        method: 'GET', url: `/integracion/bodegas/${b}/consolidado`,
      })).json<{ items: { nombre: string; valorFinal: string; origenValor: string; codigoRazon: string | null; codigo: string | null }[] }>();

      const arroz = items.find((i) => i.nombre === 'ARROZ DIANA LIBRA')!;
      const panela = items.find((i) => i.nombre === 'PANELA CUADRADA')!;

      expect(Number(arroz.valorFinal)).toBe(40);
      expect(arroz.origenValor).toBe('conteo_ciego');
      expect(arroz.codigo).toBe('7001');

      expect(Number(panela.valorFinal)).toBe(23);
      expect(panela.origenValor).toBe('auditor');
      expect(panela.codigoRazon).toBe('MERMA');
      // FR-7.1 · El código va cuando existe; el nombre siempre.
      expect(panela.codigo).toBeNull();
    });

    it('el Operador NO puede descargarlo (FR-7.8)', async () => {
      const { bodegaId: b } = await bodegaAvalada();
      for (const url of [
        `/integracion/bodegas/${b}/consolidado`,
        `/integracion/bodegas/${b}/exportacion.csv`,
        `/integracion/bodegas/${b}/constancias`,
      ]) {
        expect((await pedir(cookieOperador, { method: 'GET', url })).statusCode, url).toBe(403);
      }
    });
  });

  describe('la exportación (H7-01, FR-7.2)', () => {
    it('el CSV abre bien en Excel en español: BOM y punto y coma', async () => {
      const { bodegaId: b } = await bodegaAvalada();

      const r = await pedir(cookieAuditor, { method: 'GET', url: `/integracion/bodegas/${b}/exportacion.csv` });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/csv/);

      // Sin BOM las tildes salen rotas; con coma, Excel en español mete todo en
      // una sola columna y la persona concluye que el sistema exporta mal.
      expect(r.body.startsWith('﻿')).toBe(true);
      const cabecera = r.body.split('\r\n')[0]!;
      expect(cabecera).toContain('Artículo');
      expect(cabecera.split(';').length).toBe(10);
    });

    it('el XLSX es un libro real, con encabezado legible', async () => {
      const { bodegaId: b } = await bodegaAvalada();

      const r = await pedir(cookieAuditor, { method: 'GET', url: `/integracion/bodegas/${b}/exportacion.xlsx` });
      expect(r.statusCode).toBe(200);

      const libro = XLSX.read(r.rawPayload, { type: 'buffer' });
      const hoja = libro.Sheets[libro.SheetNames[0]!]!;
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja);

      expect(filas).toHaveLength(2);
      expect(filas[0]).toHaveProperty('Valor final');
      expect(filas[0]).toHaveProperty('Origen del valor');
    });

    it('traduce los códigos internos a algo que una persona entiende', async () => {
      const { bodegaId: b } = await bodegaAvalada();
      const r = await pedir(cookieAuditor, { method: 'GET', url: `/integracion/bodegas/${b}/exportacion.csv` });

      // `sin_cobertura` no significa nada para quien abre el archivo.
      expect(r.body).toContain('Reconteo del Auditor');
      expect(r.body).toContain('Conciliado');
      expect(r.body).not.toMatch(/conteo_ciego|sin_cobertura/);
    });

    it('SC-7.4 · todos los artículos declaran el origen de su valor', async () => {
      const { bodegaId: b, ids } = await bodegaCon([
        { nombre: 'CONTADO', saldo: '5.000' },
        { nombre: 'JAMAS CONTADO', saldo: '5.000' },
      ]);
      await contar(b, new Map([[ids[0]!, 5]]));

      const r = await pedir(cookieAuditor, { method: 'GET', url: `/integracion/bodegas/${b}/exportacion.csv` });
      const filas = r.body.split('\r\n').slice(1).filter(Boolean);

      // El que nadie contó también lo dice, en vez de dejar la celda vacía.
      expect(filas.every((f) => f.split(';')[7] !== '')).toBe(true);
      expect(r.body).toContain('Sin valor final');
    });
  });

  describe('el aval del Auditor mueve la tabla madre (D8, FR-7.9)', () => {
    it('con auditables pendientes NO se cierra ni se exporta como definitivo', async () => {
      const { bodegaId: b, ids } = await bodegaCon([{ nombre: 'PENDIENTE', saldo: '30.000' }]);
      await contar(b, new Map([[ids[0]!, 3]]));

      const cierre = await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` });
      expect(cierre.statusCode).toBe(400);
      expect(cierre.json<{ codigo: string }>().codigo).toBe('AUDITABLES_PENDIENTES');

      const definitivo = await pedir(cookieAuditor, {
        method: 'GET', url: `/integracion/bodegas/${b}/exportacion.csv?definitivo=true`,
      });
      expect(definitivo.statusCode).toBe(400);

      // El preliminar SÍ se descarga: sirve a mitad del inventario.
      const preliminar = await pedir(cookieAuditor, {
        method: 'GET', url: `/integracion/bodegas/${b}/exportacion.csv`,
      });
      expect(preliminar.statusCode).toBe(200);
      expect(preliminar.headers['content-disposition']).toContain('preliminar');
    });

    it('el saldo del sistema NO se toca hasta el cierre avalado', async () => {
      const { bodegaId: b, ids } = await bodegaCon([{ nombre: 'INTOCADO', saldo: '40.000' }]);
      await contar(b, new Map([[ids[0]!, 12]]));

      // Se contó 12 contra 40, el Auditor todavía no ha avalado nada.
      const [antes] = await sql<{ cantidad: string }[]>`
        SELECT cantidad FROM saldo_esperado WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(Number(antes!.cantidad)).toBe(40);
    });

    it('al cerrar, el saldo del sistema adopta el valor final', async () => {
      const { bodegaId: b, ids } = await bodegaAvalada();

      const r = await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` });
      expect(r.statusCode, r.body.slice(0, 300)).toBe(201);

      const cuerpo = r.json<{ hashConsolidado: string; saldosActualizados: number }>();
      expect(cuerpo.hashConsolidado).toHaveLength(64);
      expect(cuerpo.saldosActualizados).toBe(2);

      const saldos = await sql<{ articulo_id: string; cantidad: string }[]>`
        SELECT articulo_id, cantidad FROM saldo_esperado WHERE bodega_id = ${b} ORDER BY articulo_id`;
      const porId = new Map(saldos.map((s) => [s.articulo_id, Number(s.cantidad)]));

      // 40 se confirmó por conteo ciego; 25 lo corrigió el Auditor a 23.
      expect(porId.get(ids[0]!)).toBe(40);
      expect(porId.get(ids[1]!)).toBe(23);
    });

    it('un inventario no se cierra dos veces', async () => {
      const { bodegaId: b } = await bodegaAvalada();
      expect((await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` })).statusCode).toBe(201);

      const segundo = await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` });
      expect(segundo.statusCode).toBe(400);
      expect(segundo.json<{ codigo: string }>().codigo).toBe('INVENTARIO_YA_CERRADO');
    });
  });

  describe('el envío al sistema central (H7-03, H7-04)', () => {
    it('no se envía un inventario que nadie avaló (FR-7.9)', async () => {
      const { bodegaId: b } = await bodegaAvalada();

      const r = await pedir(cookieAdmin, { method: 'POST', url: `/integracion/bodegas/${b}/envio` });
      expect(r.statusCode, r.body.slice(0, 300)).toBe(400);
      expect(r.json<{ codigo: string }>().codigo, r.body.slice(0, 300)).toBe('INVENTARIO_NO_CERRADO');
    });

    it('cerrado, se envía y deja constancia (FR-7.5)', async () => {
      const { bodegaId: b } = await bodegaAvalada();
      await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` });

      const r = await pedir(cookieAdmin, { method: 'POST', url: `/integracion/bodegas/${b}/envio` });
      expect(r.statusCode).toBe(201);

      const envio = r.json<{ estado: string; enviadas: number; aceptadas: number; referencia: string }>();
      expect(envio).toMatchObject({ estado: 'aceptado', enviadas: 2, aceptadas: 2 });

      const { items } = (await pedir(cookieAuditor, {
        method: 'GET', url: `/integracion/bodegas/${b}/constancias`,
      })).json<{ items: { destino: string; usuario: string; referencia: string }[] }>();

      const alErp = items.find((i) => i.destino === 'erp')!;
      expect(alErp.usuario).toBe('Administrador de Prueba');
      expect(alErp.referencia).toBe(envio.referencia);
    });

    it('SC-7.2 · reenviar NO duplica movimientos (FR-7.4)', async () => {
      const { bodegaId: b } = await bodegaAvalada();
      await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` });

      const uno = await pedir(cookieAdmin, { method: 'POST', url: `/integracion/bodegas/${b}/envio` });
      const dos = await pedir(cookieAdmin, { method: 'POST', url: `/integracion/bodegas/${b}/envio` });

      // La referencia se deriva del CONTENIDO avalado, no de la hora: el
      // reintento de un envío cuyo resultado se desconoce es el caso real.
      expect(dos.json<{ referencia: string }>().referencia).toBe(uno.json<{ referencia: string }>().referencia);
      expect(dos.json<{ reenvio: boolean }>().reenvio).toBe(true);

      const [constancias] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM constancia_salida WHERE bodega_id = ${b} AND destino = 'erp'`;
      expect(constancias!.n).toBe(1);
    });

    it('solo el Administrador envía al sistema central', async () => {
      const { bodegaId: b } = await bodegaAvalada();
      await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/cierre` });

      expect((await pedir(cookieAuditor, { method: 'POST', url: `/integracion/bodegas/${b}/envio` })).statusCode).toBe(403);
      expect((await pedir(cookieOperador, { method: 'POST', url: `/integracion/bodegas/${b}/envio` })).statusCode).toBe(403);
    });

    it('cada descarga queda registrada con su autor (SC-7.3)', async () => {
      const { bodegaId: b } = await bodegaAvalada();

      await pedir(cookieAuditor, { method: 'GET', url: `/integracion/bodegas/${b}/exportacion.csv` });
      await pedir(cookieAdmin, { method: 'GET', url: `/integracion/bodegas/${b}/exportacion.xlsx` });

      const { items } = (await pedir(cookieAuditor, {
        method: 'GET', url: `/integracion/bodegas/${b}/constancias`,
      })).json<{ items: { destino: string; usuario: string }[] }>();

      expect(items.find((i) => i.destino === 'csv')?.usuario).toBe('Auditor de Prueba');
      expect(items.find((i) => i.destino === 'xlsx')?.usuario).toBe('Administrador de Prueba');
    });
  });
});
