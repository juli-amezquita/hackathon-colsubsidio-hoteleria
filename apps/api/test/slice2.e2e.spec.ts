import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { MAX_VERIFICACIONES } from '../src/modules/captura/validacion';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Slice 2 — Historia 2: validaciones y discrepancia (prueba E3).
 *
 * Lo que se demuestra aquí es el valor diferencial frente al papel: el error se
 * atrapa cuando corregirlo cuesta tres metros, no una semana después cuando ya
 * nadie recuerda qué había en el estante.
 *
 * Y se demuestra sin romper la ceguera. Las dos cosas a la vez son el punto
 * difícil: alertar es dar información, y toda información sobre el saldo es
 * exactamente lo que FR-1.18 prohíbe.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';
const BODEGA_PRUEBA = 'ZOOLOGICO'; // pequeña Y con artículos por peso: hace falta merma real.

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
  ip = `10.2.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 2 · validación contra el saldo esperado', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookie: string;
  let bodegaId: string;

  const pedir = (opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: { cookie, 'content-type': 'application/json' },
      // El límite de tasa es por IP y las suites corren en paralelo: sin una
      // IP propia por archivo, se consumen el cupo entre ellas.
      remoteAddress: ip,
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
      remoteAddress: '10.2.0.0',
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

  interface Articulo {
    id: string;
    nombre: string;
    unidad_esperada_id: string;
    saldo: string;
    es_peso: boolean;
  }

  /** Un artículo con saldo conocido, por tipo de unidad. */
  const articuloCon = async (esPeso: boolean): Promise<Articulo> => {
    const [a] = await sql<Articulo[]>`
      SELECT a.id, a.nombre, a.unidad_esperada_id, s.cantidad AS saldo, u.es_peso
      FROM articulo a
      JOIN unidad_medida u ON u.id = a.unidad_esperada_id
      JOIN saldo_esperado s ON s.articulo_id = a.id AND s.bodega_id = a.bodega_id
      WHERE a.bodega_id = ${bodegaId} AND u.es_peso = ${esPeso} AND s.cantidad > 10
      ORDER BY a.nombre
      LIMIT 1`;
    return a!;
  };

  const otraUnidad = async (distintaDe: string): Promise<string> => {
    const [u] = await sql<{ id: string }[]>`
      SELECT id FROM unidad_medida WHERE id <> ${distintaDe} LIMIT 1`;
    return u!.id;
  };

  // ────────────────────────────────────────────────────────────────────
  // E3 · La validación atrapa el error frente al estante
  // ────────────────────────────────────────────────────────────────────

  describe('E3 · unidad y cantidad', () => {
    it('la unidad equivocada alerta e indica cuál es la correcta (FR-2.1)', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(false);

      const r = await registrar(ronda, {
        articuloId: a.id,
        cantidad: 20,
        unidadId: await otraUnidad(a.unidad_esperada_id),
      });

      expect(r.statusCode).toBe(201);
      const v = r.json<{ validacion: { resultado: string; unidadCorrecta: { id: string } | null } }>().validacion;
      expect(v.resultado).toBe('alerta_unidad');
      expect(v.unidadCorrecta?.id).toBe(a.unidad_esperada_id);
    });

    it('contar exactamente el saldo esperado no alerta', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(false);

      const r = await registrar(ronda, {
        articuloId: a.id,
        cantidad: Number(a.saldo),
        unidadId: a.unidad_esperada_id,
      });

      expect(r.json<{ validacion: { resultado: string } }>().validacion.resultado).toBe('aceptado');
    });

    it('una diferencia relevante alerta (FR-2.2)', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(false);

      const r = await registrar(ronda, {
        articuloId: a.id,
        cantidad: Math.max(0, Number(a.saldo) - 40),
        unidadId: a.unidad_esperada_id,
      });

      const v = r.json<{ validacion: { resultado: string; exigeEvidencia: boolean } }>().validacion;
      expect(v.resultado).toBe('alerta_discrepancia');
      // Todavía no hay nada que respaldar: hay una pregunta abierta.
      expect(v.exigeEvidencia).toBe(false);
    });

    it('en artículos de peso, una diferencia dentro de la merma no alerta (FR-2.3)', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(true);

      const [cfg] = await sql<{ porcentaje: string }[]>`
        SELECT cm.porcentaje FROM configuracion_merma cm
        JOIN unidad_medida u ON u.id = cm.unidad_id
        WHERE u.id = ${a.unidad_esperada_id}`;

      // Justo por debajo del límite. Que el límite EXACTO caiga dentro lo
      // verifica `validacion.spec.ts` en aritmética exacta; aquí interesa que
      // la tolerancia llegue realmente hasta la comparación.
      const dentro = Number(a.saldo) * (1 - Number(cfg!.porcentaje) / 2);

      const r = await registrar(ronda, {
        articuloId: a.id,
        cantidad: Number(dentro.toFixed(3)),
        unidadId: a.unidad_esperada_id,
      });

      expect(r.json<{ validacion: { resultado: string } }>().validacion.resultado).toBe('aceptado');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // La alerta no puede convertirse en un buscador del saldo
  // ────────────────────────────────────────────────────────────────────

  describe('E3 · la alerta no revela el saldo ni su magnitud (FR-1.18, H2-04)', () => {
    it('sobrar y faltar producen respuestas IDÉNTICAS', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(false);
      const saldo = Number(a.saldo);

      const menos = await registrar(ronda, {
        articuloId: a.id, cantidad: 1, unidadId: a.unidad_esperada_id,
      });
      const mas = await registrar(ronda, {
        articuloId: a.id, cantidad: saldo * 10, unidadId: a.unidad_esperada_id,
        confirmaCorreccion: true,
      });

      // Si difirieran en algo, ese algo sería la dirección — y con dirección
      // más reintentos, el saldo se encuentra por bisección.
      expect(mas.json<{ validacion: unknown }>().validacion)
        .toEqual(menos.json<{ validacion: unknown }>().validacion);
    });

    it('las verificaciones se agotan: el sondeo deja de responder', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(false);

      const resultados: string[] = [];
      for (let i = 0; i < MAX_VERIFICACIONES + 2; i++) {
        const r = await registrar(ronda, {
          articuloId: a.id,
          cantidad: i + 1,
          unidadId: a.unidad_esperada_id,
          confirmaCorreccion: i > 0,
        });
        resultados.push(r.json<{ validacion: { resultado: string } }>().validacion.resultado);
      }

      expect(resultados.slice(0, MAX_VERIFICACIONES).every((v) => v === 'alerta_discrepancia')).toBe(true);
      expect(resultados.slice(MAX_VERIFICACIONES).every((v) => v === 'sin_verificacion')).toBe(true);
    });

    it('ninguna respuesta de la validación lleva el saldo ni la tolerancia', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(true);

      const r = await registrar(ronda, {
        articuloId: a.id, cantidad: 1, unidadId: a.unidad_esperada_id,
      });

      const escalares: unknown[] = [];
      const recorrer = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(recorrer);
        else if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
        else escalares.push(v);
      };
      recorrer(r.json());

      const [ctx] = await sql<{ cantidad: string; porcentaje: string | null }[]>`
        SELECT s.cantidad, cm.porcentaje
        FROM saldo_esperado s
        JOIN articulo a ON a.id = s.articulo_id
        LEFT JOIN configuracion_merma cm ON cm.unidad_id = a.unidad_esperada_id
        WHERE s.articulo_id = ${a.id} AND s.bodega_id = ${bodegaId}`;

      for (const prohibido of [ctx!.cantidad, ctx!.porcentaje].filter((x): x is string => x !== null)) {
        const fuga = escalares.find(
          (v) => (typeof v === 'number' || typeof v === 'string') && Number(v) === Number(prohibido),
        );
        expect(fuga, `El acuse de validación lleva el valor prohibido ${prohibido}`).toBeUndefined();
      }
    });

    it('el servidor SÍ congela la tolerancia que aplicó (FR-8.2)', async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(true);

      const r = await registrar(ronda, {
        articuloId: a.id, cantidad: 1, unidadId: a.unidad_esperada_id,
      });
      const { registroId } = r.json<{ registroId: string }>();

      const [fila] = await sql<{ tolerancia_aplicada: string | null; resultado_validacion: string }[]>`
        SELECT tolerancia_aplicada, resultado_validacion FROM registro_conteo WHERE id = ${registroId}`;

      // Congelada en la fila: si mañana el Administrador cambia la merma, este
      // conteo sigue explicándose con la que se le aplicó.
      expect(fila!.tolerancia_aplicada).not.toBeNull();
      expect(fila!.resultado_validacion).toBe('alerta_discrepancia');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Confirmar pese a la alerta, y lo que eso obliga
  // ────────────────────────────────────────────────────────────────────

  describe('E3 · confirmación, evidencia y cierre', () => {
    const conAlerta = async () => {
      const ronda = await abrirRonda();
      const a = await articuloCon(false);
      const primero = await registrar(ronda, {
        articuloId: a.id, cantidad: 1, unidadId: a.unidad_esperada_id,
      });
      expect(primero.json<{ validacion: { resultado: string } }>().validacion.resultado)
        .toBe('alerta_discrepancia');
      return { ronda, a };
    };

    it('confirmar pese a la alerta marca advertencia y exige evidencia (FR-2.4)', async () => {
      const { ronda, a } = await conAlerta();

      const r = await registrar(ronda, {
        articuloId: a.id, cantidad: 1, unidadId: a.unidad_esperada_id,
        confirmaPeseAAlerta: true,
      });

      expect(r.statusCode).toBe(201);
      const v = r.json<{ validacion: { exigeEvidencia: boolean } }>().validacion;
      expect(v.exigeEvidencia).toBe(true);

      const [fila] = await sql<{ advertido: boolean }[]>`
        SELECT advertido FROM registro_conteo WHERE id = ${r.json<{ registroId: string }>().registroId}`;
      expect(fila!.advertido).toBe(true);
    });

    it('corregir en vez de confirmar deja el intento anterior en la traza (FR-2.9)', async () => {
      const { ronda, a } = await conAlerta();

      const r = await registrar(ronda, {
        articuloId: a.id, cantidad: Number(a.saldo), unidadId: a.unidad_esperada_id,
        confirmaCorreccion: true,
      });
      expect(r.json<{ validacion: { resultado: string } }>().validacion.resultado).toBe('aceptado');

      const filas = await sql<{ cantidad: string; resultado_validacion: string }[]>`
        SELECT cantidad, resultado_validacion FROM registro_conteo
        WHERE ronda_id = ${ronda} AND articulo_id = ${a.id} ORDER BY secuencia`;

      // El intento alertado NO desaparece. Es la diferencia entre un libro y
      // una tabla: lo que se corrigió también es información.
      expect(filas).toHaveLength(2);
      expect(filas[0]!.resultado_validacion).toBe('alerta_discrepancia');
      expect(filas[1]!.resultado_validacion).toBe('aceptado');
    });

    it('una alerta sin responder bloquea el cierre (FR-2.8)', async () => {
      const { ronda } = await conAlerta();

      const cuadre = await pedir({ method: 'GET', url: `/rondas/${ronda}/cuadre-cierre` });
      const { pendientes, bloqueos } = cuadre.json<{
        pendientes: { articuloId: string }[];
        bloqueos: { motivo: string }[];
      }>();

      // El cuadre AVISA de lo que va a bloquear, con la misma regla que bloquea.
      expect(bloqueos.some((b) => b.motivo === 'alerta_sin_responder')).toBe(true);

      const r = await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/cierre`,
        payload: {
          decisiones: pendientes.map((p) => ({
            articuloId: p.articuloId, estado: 'no_contado', claveIdempotencia: randomUUID(),
          })),
        },
      });

      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('ALERTAS_SIN_RESOLVER');
    });

    it('confirmada la alerta, el cierre sigue bloqueado hasta que llegue la evidencia', async () => {
      const { ronda, a } = await conAlerta();

      const confirmado = await registrar(ronda, {
        articuloId: a.id, cantidad: 1, unidadId: a.unidad_esperada_id,
        confirmaPeseAAlerta: true,
      });
      const { registroId } = confirmado.json<{ registroId: string }>();

      const cuadre = await pedir({ method: 'GET', url: `/rondas/${ronda}/cuadre-cierre` });
      const { pendientes } = cuadre.json<{ pendientes: { articuloId: string }[] }>();
      const decisiones = pendientes.map((p) => ({
        articuloId: p.articuloId, estado: 'no_contado' as const, claveIdempotencia: randomUUID(),
      }));

      const sinEvidencia = await pedir({
        method: 'POST', url: `/rondas/${ronda}/cierre`, payload: { decisiones },
      });
      expect(sinEvidencia.statusCode).toBe(400);
      expect(sinEvidencia.json<{ codigo: string }>().codigo).toBe('EVIDENCIA_PENDIENTE');

      // La subida es diferida (D-07): el audio llega después, por su endpoint.
      const adjuntar = await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/registros/${registroId}/evidencia`,
        payload: { claveS3: `audio/${ronda}/${registroId}.webm`, claveIdempotencia: randomUUID() },
      });
      expect(adjuntar.statusCode).toBe(201);

      const conEvidencia = await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/cierre`,
        payload: { decisiones: decisiones.map((d) => ({ ...d, claveIdempotencia: randomUUID() })) },
      });
      expect(conEvidencia.statusCode).toBe(201);
      expect(conEvidencia.json<{ cerrada: boolean }>().cerrada).toBe(true);
    });

    it('contado en cero se valida como cantidad; no contado no (FR-2.7)', async () => {
      const ronda = await abrirRonda();

      const cuadre = await pedir({ method: 'GET', url: `/rondas/${ronda}/cuadre-cierre` });
      const { pendientes } = cuadre.json<{ pendientes: { articuloId: string }[] }>();

      // Todo en cero: los artículos CON saldo esperado deben alertar, porque
      // "fui, miré y no había" es exactamente la discrepancia que se busca.
      await pedir({
        method: 'POST',
        url: `/rondas/${ronda}/cierre`,
        payload: {
          decisiones: pendientes.map((p) => ({
            articuloId: p.articuloId, estado: 'contado_en_cero', claveIdempotencia: randomUUID(),
          })),
        },
      });

      const [conteo] = await sql<{ alertados: number; no_validables: number }[]>`
        SELECT count(*) FILTER (WHERE resultado_validacion = 'alerta_discrepancia')::int AS alertados,
               count(*) FILTER (WHERE resultado_validacion = 'no_validable')::int  AS no_validables
        FROM registro_conteo WHERE ronda_id = ${ronda}`;

      expect(conteo!.alertados).toBeGreaterThan(0);

      // Y en una ronda de puros `no_contado` no se genera ninguna alerta.
      const otra = await abrirRonda();
      const c2 = await pedir({ method: 'GET', url: `/rondas/${otra}/cuadre-cierre` });
      await pedir({
        method: 'POST',
        url: `/rondas/${otra}/cierre`,
        payload: {
          decisiones: c2.json<{ pendientes: { articuloId: string }[] }>().pendientes.map((p) => ({
            articuloId: p.articuloId, estado: 'no_contado', claveIdempotencia: randomUUID(),
          })),
        },
      });

      const [sinAlertas] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM registro_conteo
        WHERE ronda_id = ${otra}
          AND resultado_validacion IN ('alerta_unidad', 'alerta_discrepancia')`;
      expect(sinAlertas!.n).toBe(0);
    });
  });
});
