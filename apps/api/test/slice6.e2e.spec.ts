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
 * Slice 6 — Historia 6: continuidad ante pérdida de red (prueba E6).
 *
 * El Wi-Fi de la bodega falla a mitad del conteo. Es la diferencia entre una
 * herramienta que funciona en la bodega real y una que funciona en la oficina:
 * un microcorte que obliga a repetir trabajo se paga con que nadie la use.
 *
 * ⚠️ Lo que se prueba aquí es la MITAD del servidor. La cola con reintento, el
 * historial en pantalla y el aviso de almacenamiento agotado viven en el
 * dispositivo (F-18, H6-01, H6-03, H6-05) y los prueba el frontend. Lo que
 * corresponde a este lado es que ningún reintento duplique, que nada se pierda
 * y que el servidor pueda decir por dónde iba la ronda.
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
  ip = `10.6.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 6 · continuidad ante pérdida de red', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookie: string;
  let unidadId: string;
  let otraUnidadId: string;

  const pedir = (opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: { cookie, 'content-type': 'application/json' },
      remoteAddress: ip,
    } as never);

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 8, ssl: opcionesSsl(), onnotice: () => {} });

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
      remoteAddress: '10.6.0.0',
    } as never);
    const bruto = login.headers['set-cookie'];
    cookie = (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;

    const unidades = await sql<{ id: string; nombre: string }[]>`
      SELECT id, nombre FROM unidad_medida ORDER BY nombre`;
    unidadId = unidades.find((u) => u.nombre === 'Unidad')!.id;
    otraUnidadId = unidades.find((u) => u.nombre !== 'Unidad')!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  /** Bodega con `n` artículos, cada uno con saldo esperado conocido. */
  const bodegaCon = async (n: number, saldo = '10.000') => {
    const id = randomUUID();
    await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`H6-${id.slice(0, 8)}`}, 'Bodega de prueba H6')`;
    await sql`
      INSERT INTO usuario_bodega (usuario_id, bodega_id)
      SELECT id, ${id} FROM usuario WHERE documento = '1000000001'`;

    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const articuloId = randomUUID();
      ids.push(articuloId);
      const nombre = `ARTICULO H6 ${String(i).padStart(2, '0')}`;
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
        VALUES (${articuloId}, ${id}, ${nombre}, ${nombre.toLowerCase()}, ${unidadId})`;
      await sql`
        INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
        VALUES (${id}, ${articuloId}, ${saldo}, ${unidadId})`;
    }
    return { bodegaId: id, ids };
  };

  const abrirRonda = async (bodega: string): Promise<string> => {
    const r = await pedir({ method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(201);
    return r.json<{ rondaId: string }>().rondaId;
  };

  const sobre = (articuloId: string, cantidad: number, extra: Record<string, unknown> = {}) => ({
    articuloId,
    cantidad,
    unidadId,
    estado: 'contado',
    modoCaptura: 'voz',
    origenParse: 'gramatica',
    origenNombre: 'exacto',
    capturadoEn: new Date().toISOString(),
    // La clave la genera el DISPOSITIVO antes de intentar el envío (R2, FR-6.2).
    claveIdempotencia: randomUUID(),
    ...extra,
  });

  // ────────────────────────────────────────────────────────────────────
  // E6 · Diez cortes, cero pérdidas, cero duplicados
  // ────────────────────────────────────────────────────────────────────

  describe('E6 · diez cortes durante un conteo de 20 ítems (SC-6.1)', () => {
    it('todo lo confirmado antes de cada corte queda registrado exactamente una vez', async () => {
      const { bodegaId: b, ids } = await bodegaCon(20);
      const ronda = await abrirRonda(b);

      // Se simula lo que hace un dispositivo real: cada ítem se escribe en la
      // cola con su clave, y el envío se reintenta. En un corte, el operario NO
      // sabe si llegó, así que reintenta lo mismo — a veces varias veces.
      const cola = ids.map((id, i) => sobre(id, i + 1));
      const CORTES = 10;

      let enviados = 0;
      for (const [i, s] of cola.entries()) {
        const r = await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: s });
        expect(r.statusCode).toBe(201);
        enviados++;

        // Cada dos ítems se "corta la red": el dispositivo no recibió el acuse
        // y reintenta el MISMO sobre al volver.
        if (i % 2 === 1 && i < CORTES * 2) {
          const reintento = await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: s });
          expect(reintento.statusCode).toBe(201);
          // El reintento ve EXACTAMENTE la misma respuesta que el original.
          expect(reintento.json()).toEqual(r.json());
          enviados++;
        }
      }

      expect(enviados).toBe(30); // 20 ítems + 10 reintentos por corte

      const [conteo] = await sql<{ filas: number; articulos: number }[]>`
        SELECT count(*)::int AS filas, count(DISTINCT articulo_id)::int AS articulos
        FROM registro_conteo WHERE ronda_id = ${ronda}`;

      // Cero pérdidas y cero duplicados: 20 envíos únicos, 20 filas.
      expect(conteo!.articulos).toBe(20);
      expect(conteo!.filas).toBe(20);
    });

    it('reintentos SIMULTÁNEOS del mismo sobre tampoco duplican', async () => {
      // Es el caso real: vuelve la red y la cola del dispositivo se vacía de
      // golpe, con varios envíos del mismo ítem en vuelo a la vez.
      const { bodegaId: b, ids } = await bodegaCon(1);
      const ronda = await abrirRonda(b);
      const s = sobre(ids[0]!, 7);

      const respuestas = await Promise.all(
        Array.from({ length: 8 }, () =>
          pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: s }),
        ),
      );

      expect(respuestas.every((r) => r.statusCode === 201)).toBe(true);
      const ids_ = new Set(respuestas.map((r) => r.json<{ registroId: string }>().registroId));
      expect(ids_.size).toBe(1);

      const [filas] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM registro_conteo WHERE ronda_id = ${ronda}`;
      expect(filas!.n).toBe(1);
    });

    it('un registro confirmado sobrevive aunque el dispositivo se apague (escenario 5)', async () => {
      const { bodegaId: b, ids } = await bodegaCon(3);
      const ronda = await abrirRonda(b);

      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[0]!, 10) });
      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[1]!, 4) });

      // El dispositivo se apaga y el operario vuelve a entrar: el servidor le
      // dice por dónde iba, sin depender de la memoria del aparato.
      const estado = (await pedir({ method: 'GET', url: `/rondas/${ronda}/estado` }))
        .json<{ contados: number; total: number; ultimos: { articuloId: string }[] }>();

      expect(estado.contados).toBe(2);
      expect(estado.total).toBe(3);
      expect(estado.ultimos.map((u) => u.articuloId)).toContain(ids[1]);
    });
  });

  describe('E6 · retomar donde se quedó (FR-6.3, FR-6.4, FR-6.5)', () => {
    it('el historial trae entre 3 y 5 registros, el más reciente primero', async () => {
      const { bodegaId: b, ids } = await bodegaCon(8);
      const ronda = await abrirRonda(b);

      for (const [i, id] of ids.entries()) {
        await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(id, i + 1) });
      }

      const estado = (await pedir({ method: 'GET', url: `/rondas/${ronda}/estado` }))
        .json<{ ultimos: { articuloId: string }[] }>();

      expect(estado.ultimos.length).toBeGreaterThanOrEqual(3);
      expect(estado.ultimos.length).toBeLessThanOrEqual(5);
      expect(estado.ultimos[0]!.articuloId).toBe(ids.at(-1));
    });

    it('cada registro dice si está validado o solo guardado (FR-6.5)', async () => {
      const { bodegaId: b, ids } = await bodegaCon(2);
      const ronda = await abrirRonda(b);

      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[0]!, 10) });
      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[1]!, 1) });

      const estado = (await pedir({ method: 'GET', url: `/rondas/${ronda}/estado` }))
        .json<{ ultimos: { articuloId: string; validacion: string }[] }>();

      const porId = new Map(estado.ultimos.map((u) => [u.articuloId, u.validacion]));
      expect(porId.get(ids[0]!)).toBe('aceptado');
      expect(porId.get(ids[1]!)).toBe('alerta_discrepancia');
    });

    it('el estado NO revela el saldo esperado: lo lee un Operador (FR-1.18)', async () => {
      const { bodegaId: b, ids } = await bodegaCon(2, '77.000');
      const ronda = await abrirRonda(b);
      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[0]!, 3) });

      const cuerpo = (await pedir({ method: 'GET', url: `/rondas/${ronda}/estado` })).body;

      const escalares: unknown[] = [];
      const recorrer = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(recorrer);
        else if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
        else escalares.push(v);
      };
      recorrer(JSON.parse(cuerpo));

      const fuga = escalares.find((v) => (typeof v === 'number' || typeof v === 'string') && Number(v) === 77);
      expect(fuga).toBeUndefined();
    });
  });

  describe('E6 · alertas que llegan tarde (FR-6.7)', () => {
    it('la alerta diferida aparece en el estado aunque el operario ya avanzó', async () => {
      const { bodegaId: b, ids } = await bodegaCon(6);
      const ronda = await abrirRonda(b);

      // El ítem 0 discrepa, pero su acuse se perdió en el corte: el operario
      // siguió contando cinco artículos más sin enterarse.
      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[0]!, 1) });
      for (const id of ids.slice(1)) {
        await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(id, 10) });
      }

      const estado = (await pedir({ method: 'GET', url: `/rondas/${ronda}/estado` }))
        .json<{ pendientesDeResolver: { articuloId: string; motivo: string }[] }>();

      // Sin esto se enteraría al intentar cerrar, con la ronda entera hecha.
      expect(estado.pendientesDeResolver).toHaveLength(1);
      expect(estado.pendientesDeResolver[0]).toMatchObject({
        articuloId: ids[0], motivo: 'alerta_sin_responder',
      });
    });

    it('resolverla la saca del estado y desbloquea el cierre', async () => {
      const { bodegaId: b, ids } = await bodegaCon(2);
      const ronda = await abrirRonda(b);
      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[0]!, 1) });

      await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/registros`,
        payload: sobre(ids[0]!, 10, { confirmaCorreccion: true }),
      });

      const estado = (await pedir({ method: 'GET', url: `/rondas/${ronda}/estado` }))
        .json<{ pendientesDeResolver: unknown[] }>();
      expect(estado.pendientesDeResolver).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // FR-6.9 · El servidor re-resuelve, y no corrige en silencio
  // ────────────────────────────────────────────────────────────────────

  describe('la resolución del servidor prevalece pero NO corrige callada (FR-6.9)', () => {
    it('cuando coincide con la del dispositivo, no marca nada', async () => {
      const { bodegaId: b, ids } = await bodegaCon(2);
      const ronda = await abrirRonda(b);
      const [nombre] = await sql<{ nombre: string }[]>`SELECT nombre FROM articulo WHERE id = ${ids[0]!}`;

      await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/registros`,
        payload: sobre(ids[0]!, 10, { textoDictado: nombre!.nombre }),
      });

      const [fila] = await sql<{ resolucion_discrepante: boolean; articulo_servidor: string | null }[]>`
        SELECT resolucion_discrepante, articulo_servidor FROM registro_conteo
        WHERE ronda_id = ${ronda} AND articulo_id = ${ids[0]!}`;

      expect(fila!.resolucion_discrepante).toBe(false);
      expect(fila!.articulo_servidor).toBe(ids[0]);
    });

    it('cuando difiere, MARCA la fila y NO toca el dato del operario', async () => {
      const { bodegaId: b, ids } = await bodegaCon(3);
      const ronda = await abrirRonda(b);

      // El dispositivo dice haber contado el artículo 0, pero el texto que
      // dictó la persona resuelve inequívocamente al artículo 2. Es lo que
      // pasa con un catálogo cacheado que quedó viejo.
      const [otro] = await sql<{ nombre: string }[]>`SELECT nombre FROM articulo WHERE id = ${ids[2]!}`;

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/registros`,
        payload: sobre(ids[0]!, 10, { textoDictado: otro!.nombre }),
      });
      expect(r.statusCode).toBe(201);

      const [fila] = await sql<
        { articulo_id: string; articulo_servidor: string; resolucion_discrepante: boolean; cantidad: string }[]
      >`
        SELECT articulo_id, articulo_servidor, resolucion_discrepante, cantidad
        FROM registro_conteo WHERE ronda_id = ${ronda}`;

      // El conteo queda donde el operario lo puso. Corregirlo en silencio
      // dejaría a la persona contando un artículo y al sistema guardando otro.
      expect(fila!.articulo_id).toBe(ids[0]);
      expect(fila!.articulo_servidor).toBe(ids[2]);
      expect(fila!.resolucion_discrepante).toBe(true);
      expect(Number(fila!.cantidad)).toBe(10);
    });

    it('la captura manual por lista no se re-resuelve: nadie dictó nada', async () => {
      const { bodegaId: b, ids } = await bodegaCon(2);
      const ronda = await abrirRonda(b);
      const [otro] = await sql<{ nombre: string }[]>`SELECT nombre FROM articulo WHERE id = ${ids[1]!}`;

      await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/registros`,
        payload: sobre(ids[0]!, 10, { textoDictado: otro!.nombre, origenParse: 'manual', origenNombre: null }),
      });

      const [fila] = await sql<{ resolucion_discrepante: boolean }[]>`
        SELECT resolucion_discrepante FROM registro_conteo WHERE ronda_id = ${ronda}`;
      // El operario tocó el artículo en pantalla: no hay resolución que contrastar.
      expect(fila!.resolucion_discrepante).toBe(false);
    });

    it('sin texto dictado, el servidor no inventa una discrepancia', async () => {
      const { bodegaId: b, ids } = await bodegaCon(2);
      const ronda = await abrirRonda(b);

      await pedir({ method: 'POST', url: `/rondas/${ronda}/registros`, payload: sobre(ids[0]!, 10) });

      const [fila] = await sql<{ resolucion_discrepante: boolean; texto_dictado: string | null }[]>`
        SELECT resolucion_discrepante, texto_dictado FROM registro_conteo WHERE ronda_id = ${ronda}`;
      expect(fila!.resolucion_discrepante).toBe(false);
      expect(fila!.texto_dictado).toBeNull();
    });

    it('la unidad equivocada sigue alertando aunque el nombre resuelva bien', async () => {
      // Comprobación de que la re-resolución no atropella la validación.
      const { bodegaId: b, ids } = await bodegaCon(2);
      const ronda = await abrirRonda(b);
      const [nombre] = await sql<{ nombre: string }[]>`SELECT nombre FROM articulo WHERE id = ${ids[0]!}`;

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/registros`,
        payload: sobre(ids[0]!, 10, { textoDictado: nombre!.nombre, unidadId: otraUnidadId }),
      });

      expect(r.json<{ validacion: { resultado: string } }>().validacion.resultado).toBe('alerta_unidad');
    });
  });
});
