import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Slice 1 — Historia 1: conteo ciego en ronda propia.
 *
 * E1 (extremo a extremo) y **E2, la prueba innegociable del proyecto**: que el
 * saldo esperado no sea obtenible desde el dispositivo por ningún medio.
 *
 * Si E2 se cae, el conteo dejó de ser ciego y el sistema perdió su garantía
 * principal — la que sostiene D5, y con ella la conciliación automática. No se
 * despliega con esta prueba en rojo.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

/** Bodega pequeña: el cuadre de cierre es manejable en una prueba. */
const BODEGA_PRUEBA = 'STOCK KIOSCO PISCIGIROS AYB';

describe('Slice 1 · conteo ciego en ronda propia', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookie: string;
  let bodegaId: string;

  const pedir = (opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: { cookie, 'content-type': 'application/json' },
    } as never);

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 4, ssl: opcionesSsl(), onnotice: () => {} });

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await registrarSeguridad(app);
    app.useGlobalGuards(new SesionGuard(app.get(Reflector), app.get(SesionService)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const login = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: '1000000001', password: 'Inventario2026*' },
    });
    const bruto = login.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;

    const [b] = await sql<{ id: string }[]>`SELECT id FROM bodega WHERE codigo = ${BODEGA_PRUEBA}`;
    bodegaId = b!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  const abrirRonda = async (): Promise<string> => {
    const r = await pedir({ method: 'POST', url: '/rondas', payload: { bodegaId } });
    expect(r.statusCode).toBe(201);
    return r.json<{ rondaId: string }>().rondaId;
  };

  const registrar = (rondaId: string, extra: Record<string, unknown>) =>
    pedir({
      method: 'POST',
      url: `/rondas/${rondaId}/registros`,
      payload: {
        estado: 'contado',
        modoCaptura: 'voz',
        origenParse: 'gramatica',
        origenNombre: 'similitud',
        capturadoEn: new Date().toISOString(),
        claveIdempotencia: randomUUID(),
        ...extra,
      },
    });

  const unArticulo = async () => {
    const [a] = await sql<{ id: string; nombre: string; unidad_esperada_id: string }[]>`
      SELECT id, nombre, unidad_esperada_id FROM articulo WHERE bodega_id = ${bodegaId} LIMIT 1`;
    return a!;
  };

  // ────────────────────────────────────────────────────────────────────
  // E2 · LA PRUEBA INNEGOCIABLE
  // ────────────────────────────────────────────────────────────────────

  describe('E2 · el saldo esperado NO es obtenible desde el dispositivo', () => {
    /**
     * Recorre TODA respuesta que la API puede devolver a un rol Operador y
     * verifica que no aparece el saldo esperado, ni la tolerancia, ni nada de
     * lo que se derive.
     *
     * Se compara contra los valores REALES de la base, no contra un nombre de
     * campo: renombrar `saldo_esperado` a `sd` no burlaría esta prueba.
     */
    const noFiltra = async (cuerpo: string, articuloId: string) => {
      const [ctx] = await sql<{ cantidad: string | null; porcentaje: string | null }[]>`
        SELECT s.cantidad, cm.porcentaje
        FROM articulo a
        JOIN unidad_medida u ON u.id = a.unidad_esperada_id
        LEFT JOIN saldo_esperado s ON s.articulo_id = a.id
        LEFT JOIN configuracion_merma cm ON cm.unidad_id = u.id
        WHERE a.id = ${articuloId}`;

      const prohibidos = [ctx?.cantidad, ctx?.porcentaje].filter(
        (v): v is string => v !== null && v !== undefined,
      );

      // Se recorre el JSON valor por valor en vez de buscar subcadenas: un
      // saldo de 3 aparece como texto dentro de cualquier UUID, y esa falsa
      // alarma volvería la prueba inútil. Recorrer los valores conserva lo que
      // importa —comparar contra el dato real, no contra un nombre de campo—
      // sin depender de cómo se llame la clave que lo transporte.
      const escalares: unknown[] = [];
      const recorrer = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(recorrer);
        else if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
        else escalares.push(v);
      };
      recorrer(JSON.parse(cuerpo));

      for (const valor of prohibidos) {
        const numero = Number(valor);
        const fuga = escalares.find(
          (v) => (typeof v === 'number' || typeof v === 'string') && Number(v) === numero,
        );
        // Una colisión con un código de artículo daría un falso positivo. Es la
        // dirección segura del error: falla de más, nunca de menos.
        expect(fuga, `Una respuesta al Operador lleva el valor prohibido ${valor}`).toBeUndefined();
      }

      // Y por si acaso, los nombres de campo.
      expect(cuerpo).not.toMatch(/saldoEsperado|saldo_esperado|toleranciaMerma|tolerancia_aplicada/i);
    };

    it('el catálogo que se cachea en el dispositivo no trae saldos', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await pedir({ method: 'GET', url: `/rondas/${rondaId}/catalogo` });
      expect(r.statusCode).toBe(200);
      await noFiltra(r.body, a.id);
    });

    it('la resolución del nombre no trae saldos', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${rondaId}/resolucion-articulo`,
        payload: { textoDictado: a.nombre },
      });

      expect(r.statusCode).toBe(201);
      await noFiltra(r.body, a.id);
    });

    it('el acuse de un registro no trae saldos, aunque el servidor SÍ los congeló', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await registrar(rondaId, {
        articuloId: a.id,
        cantidad: 7,
        unidadId: a.unidad_esperada_id,
      });

      expect(r.statusCode).toBe(201);
      await noFiltra(r.body, a.id);

      // El servidor sí guardó el saldo del sistema junto a lo contado (D8):
      // la fila tiene las dos mitades. Lo que no ocurre es que salga.
      const [fila] = await sql<{ saldo_esperado_congelado: string | null }[]>`
        SELECT saldo_esperado_congelado FROM registro_conteo
        WHERE ronda_id = ${rondaId} AND articulo_id = ${a.id}`;
      expect(fila?.saldo_esperado_congelado).not.toBeNull();
    });

    it('el cuadre de cierre no trae saldos', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await pedir({ method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
      expect(r.statusCode).toBe(200);
      await noFiltra(r.body, a.id);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // E1 · Extremo a extremo
  // ────────────────────────────────────────────────────────────────────

  describe('E1 · el flujo completo del Operador', () => {
    it('abre una ronda propia que no pisa ninguna otra', async () => {
      const a = await abrirRonda();
      const b = await abrirRonda();
      expect(a).not.toBe(b);

      const [n] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM ronda WHERE id IN (${a}, ${b})`;
      expect(n?.n).toBe(2);
    });

    it('resuelve un nombre dictado con error de transcripción', async () => {
      const rondaId = await abrirRonda();

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${rondaId}/resolucion-articulo`,
        payload: { textoDictado: 'agua botela' },
      });

      const res = r.json<{ estado: string; articulo: { nombre: string } | null }>();
      expect(['resuelto', 'candidatos']).toContain(res.estado);
      if (res.estado === 'resuelto') expect(res.articulo?.nombre).toMatch(/AGUA/i);
    });

    it('ofrece candidatos cuando el nombre es ambiguo, sin elegir', async () => {
      const rondaId = await abrirRonda();

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${rondaId}/resolucion-articulo`,
        payload: { textoDictado: 'agua' },
      });

      const res = r.json<{ estado: string; candidatos: unknown[]; articulo: unknown }>();
      // El catálogo tiene AGUA 280 ML, AGUA BOTELLA, AGUA BOTELLON, AGUA
      // SABORIZADA. Decir "agua" no alcanza y el sistema NO debe elegir.
      expect(res.estado).toBe('candidatos');
      expect(res.candidatos.length).toBeGreaterThan(1);
      expect(res.articulo).toBeNull();
    });

    it('registra con secuencia monótona y devuelve el sello del servidor', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await registrar(rondaId, {
        articuloId: a.id,
        cantidad: 12,
        unidadId: a.unidad_esperada_id,
      });

      const res = r.json<{ secuencia: number; recibidoEn: string }>();
      expect(res.secuencia).toBe(1);
      expect(new Date(res.recibidoEn).getTime()).toBeGreaterThan(0);
    });

    it('el mismo envío repetido guarda UNA vez', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();
      const clave = randomUUID();

      const carga = {
        articuloId: a.id,
        cantidad: 9,
        unidadId: a.unidad_esperada_id,
        claveIdempotencia: clave,
      };

      const primero = await registrar(rondaId, carga);
      const segundo = await registrar(rondaId, carga);

      expect(primero.statusCode).toBe(201);
      expect(segundo.statusCode).toBe(201);
      // El reintento ve exactamente la misma respuesta.
      expect(segundo.json<{ registroId: string }>().registroId).toBe(
        primero.json<{ registroId: string }>().registroId,
      );
    });

    it('D4 · recontar el mismo artículo exige confirmación y NO suma', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      await registrar(rondaId, { articuloId: a.id, cantidad: 10, unidadId: a.unidad_esperada_id });

      // Sin confirmar: se rechaza.
      const sinConfirmar = await registrar(rondaId, {
        articuloId: a.id,
        cantidad: 25,
        unidadId: a.unidad_esperada_id,
      });
      expect(sinConfirmar.statusCode).toBe(409);
      expect(sinConfirmar.json<{ codigo: string }>().codigo).toBe('ARTICULO_YA_CONTADO');

      // Confirmando: supersede.
      const confirmado = await registrar(rondaId, {
        articuloId: a.id,
        cantidad: 25,
        unidadId: a.unidad_esperada_id,
        confirmaCorreccion: true,
      });
      expect(confirmado.statusCode).toBe(201);
      expect(confirmado.json<{ secuencia: number }>().secuencia).toBe(2);

      // Las DOS filas siguen ahí: la corrección no borró la anterior (D2).
      const filas = await sql<{ secuencia: number; cantidad: string }[]>`
        SELECT secuencia, cantidad FROM registro_conteo
        WHERE ronda_id = ${rondaId} AND articulo_id = ${a.id} ORDER BY secuencia`;
      expect(filas).toHaveLength(2);
      expect(Number(filas[0]!.cantidad)).toBe(10);
      expect(Number(filas[1]!.cantidad)).toBe(25);

      // Y el vigente es 25, no 35: la cantidad es el TOTAL, no un incremento.
      const [vigente] = await sql<{ cantidad: string }[]>`
        SELECT cantidad FROM registro_vigente
        WHERE ronda_id = ${rondaId} AND articulo_id = ${a.id}`;
      expect(Number(vigente!.cantidad)).toBe(25);
    });

    it('el evento se escribió en la misma transacción que el registro', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();
      await registrar(rondaId, { articuloId: a.id, cantidad: 3, unidadId: a.unidad_esperada_id });

      const [n] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM outbox
        WHERE tipo_evento = 'ConteoRegistrado' AND payload->>'rondaId' = ${rondaId}`;
      expect(n?.n).toBe(1);
    });

    it('bloquea el cierre mientras queden artículos sin decidir', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();
      await registrar(rondaId, { articuloId: a.id, cantidad: 5, unidadId: a.unidad_esperada_id });

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${rondaId}/cierre`,
        payload: { decisiones: [] },
      });

      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('CUADRE_INCOMPLETO');
    });

    it('cierra la ronda y deja TODO artículo en estado explícito', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      // Se cuenta el saldo exacto a propósito. Desde el Slice 2 una alerta sin
      // responder bloquea el cierre (FR-2.8), y lo que esta prueba mira es el
      // cuadre, no la validación: eso lo cubre `slice2.e2e.spec.ts`.
      const [s] = await sql<{ cantidad: string }[]>`
        SELECT cantidad FROM saldo_esperado
        WHERE articulo_id = ${a.id} AND bodega_id = ${bodegaId}`;

      await registrar(rondaId, {
        articuloId: a.id,
        cantidad: Number(s?.cantidad ?? 0),
        unidadId: a.unidad_esperada_id,
      });

      const cuadre = await pedir({ method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
      const pendientes = cuadre.json<{ pendientes: { articuloId: string }[] }>().pendientes;
      expect(pendientes.length).toBeGreaterThan(0);

      // *Contado en cero* y *no contado* son distintos y se conservan aparte.
      const decisiones = pendientes.map((p, i) => ({
        articuloId: p.articuloId,
        estado: i % 2 === 0 ? ('contado_en_cero' as const) : ('no_contado' as const),
        claveIdempotencia: randomUUID(),
      }));

      const cierre = await pedir({
        method: 'POST',
        url: `/rondas/${rondaId}/cierre`,
        payload: { decisiones },
      });
      expect(cierre.statusCode).toBe(201);

      // SC-1.4: el 100% del catálogo queda en un estado explícito.
      const [sinResolver] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM articulo a
        WHERE a.bodega_id = ${bodegaId} AND a.activo
          AND NOT EXISTS (SELECT 1 FROM registro_conteo r
                          WHERE r.ronda_id = ${rondaId} AND r.articulo_id = a.id)`;
      expect(sinResolver?.n).toBe(0);

      // Los dos estados se conservaron por separado (FR-1.16).
      const estados = await sql<{ estado: string; n: number }[]>`
        SELECT estado, count(*)::int n FROM registro_conteo
        WHERE ronda_id = ${rondaId} GROUP BY estado ORDER BY estado`;
      const mapa = new Map(estados.map((e) => [e.estado, e.n]));
      expect(mapa.get('contado_en_cero')).toBeGreaterThan(0);
      expect(mapa.get('no_contado')).toBeGreaterThan(0);
    }, 60_000);

    it('FR-1.17 · una ronda cerrada no admite más registros', async () => {
      const rondaId = await abrirRonda();
      const cuadre = await pedir({ method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
      const decisiones = cuadre
        .json<{ pendientes: { articuloId: string }[] }>()
        .pendientes.map((p) => ({
          articuloId: p.articuloId,
          estado: 'no_contado' as const,
          claveIdempotencia: randomUUID(),
        }));

      await pedir({ method: 'POST', url: `/rondas/${rondaId}/cierre`, payload: { decisiones } });

      const a = await unArticulo();
      const r = await registrar(rondaId, {
        articuloId: a.id,
        cantidad: 1,
        unidadId: a.unidad_esperada_id,
      });

      expect(r.statusCode).toBe(409);
      expect(r.json<{ codigo: string }>().codigo).toBe('RONDA_CERRADA');
    }, 60_000);

    it('el contrato rechaza `contado` sin cantidad antes de tocar el dominio', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await registrar(rondaId, { articuloId: a.id, cantidad: null, unidadId: null });
      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('ENTRADA_INVALIDA');
    });
  });

  describe('Aislamiento entre operarios', () => {
    it('un Operador no puede registrar en la ronda de otro', async () => {
      const rondaAjena = await abrirRonda();

      const otro = await app.getHttpAdapter().getInstance().inject({
        method: 'POST',
        url: '/sesion',
        payload: { usuario: '1000000002', password: 'Inventario2026*' },
      });
      const bruto = otro.headers['set-cookie'];
      const cookieAjena = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;

      const a = await unArticulo();
      const r = await app.getHttpAdapter().getInstance().inject({
        method: 'POST',
        url: `/rondas/${rondaAjena}/registros`,
        headers: { cookie: cookieAjena, 'content-type': 'application/json' },
        payload: {
          articuloId: a.id,
          estado: 'contado',
          cantidad: 1,
          unidadId: a.unidad_esperada_id,
          modoCaptura: 'texto',
          origenParse: 'manual',
          origenNombre: null,
          capturadoEn: new Date().toISOString(),
          claveIdempotencia: randomUUID(),
        },
      });

      // El Auditor no tiene el rol; aunque lo tuviera, la ronda no es suya.
      expect([403, 404]).toContain(r.statusCode);
    });
  });
});
