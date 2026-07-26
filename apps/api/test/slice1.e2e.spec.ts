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
  ip = `10.1.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 1 · conteo ciego en ronda propia', () => {
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
      remoteAddress: '10.1.0.0',
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

  /**
   * El artículo sobre el que se apoya toda la suite — y en particular E2.
   *
   * Dos condiciones, y las dos existen para que E2 no pueda pasar en vano:
   *
   *   · `ORDER BY` explícito. Sin él la fila que sale es indefinida y la prueba
   *     innegociable examinaría un artículo distinto en cada ejecución.
   *   · Saldo esperado obligatorio (`JOIN`, no `LEFT JOIN`). Si el artículo no
   *     tuviera saldo, `noFiltra` no tendría ningún valor prohibido contra el
   *     que comparar y pasaría sin comprobar nada.
   *
   * Y entre los que cumplen se prefiere uno con merma configurada, para que los
   * valores prohibidos sean DOS —el saldo y la tolerancia—, que son justo las
   * dos cosas que FR-1.18 prohíbe que lleguen al dispositivo.
   */
  const unArticulo = async () => {
    const [a] = await sql<
      { id: string; nombre: string; unidad_esperada_id: string; saldo: string }[]
    >`
      SELECT a.id, a.nombre, a.unidad_esperada_id, s.cantidad AS saldo
      FROM articulo a
      JOIN saldo_esperado s ON s.articulo_id = a.id AND s.bodega_id = a.bodega_id
      JOIN unidad_medida u ON u.id = a.unidad_esperada_id
      LEFT JOIN configuracion_merma cm ON cm.unidad_id = u.id
      WHERE a.bodega_id = ${bodegaId} AND a.activo
      ORDER BY (cm.porcentaje IS NULL), a.nombre
      LIMIT 1`;

    expect(a, 'La bodega de prueba no tiene ningún artículo con saldo esperado').toBeDefined();
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

      // Sin esto, un artículo sin saldo dejaría la lista vacía, el bucle de
      // abajo no se ejecutaría ni una vez y la prueba innegociable pasaría sin
      // haber comprobado nada — el peor resultado posible de una prueba.
      expect(
        prohibidos.length,
        'No hay ningún valor prohibido que buscar: la prueba no estaría comprobando nada',
      ).toBeGreaterThan(0);

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

    it('la apertura de la ronda no trae saldos', async () => {
      const a = await unArticulo();

      const r = await pedir({ method: 'POST', url: '/rondas', payload: { bodegaId } });
      expect(r.statusCode).toBe(201);
      await noFiltra(r.body, a.id);
    });

    it('la sesión del Operador no trae saldos', async () => {
      const a = await unArticulo();

      // Lo primero que pide el dispositivo al arrancar, y trae las bodegas
      // habilitadas: es superficie de Operador como cualquier otra.
      const r = await pedir({ method: 'GET', url: '/sesion' });
      expect(r.statusCode).toBe(200);
      await noFiltra(r.body, a.id);
    });

    it('el estado que el servidor devuelve al retomar la ronda no trae saldos', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      // La cantidad contada SÍ vuelve en `ultimos` —es lo que el operario
      // acaba de dictar, no un dato del sistema—, así que se cuenta algo
      // distinto del saldo a propósito: si coincidieran, la coincidencia sería
      // del propio conteo y esta prueba no distinguiría una fuga de un eco.
      await registrar(rondaId, {
        articuloId: a.id,
        cantidad: Number(a.saldo) + 1000,
        unidadId: a.unidad_esperada_id,
      });

      const r = await pedir({ method: 'GET', url: `/rondas/${rondaId}/estado` });
      expect(r.statusCode).toBe(200);
      // La alerta llega hasta aquí (FR-6.7); lo que no llega es el número que
      // la causó.
      expect(r.json<{ pendientesDeResolver: unknown[] }>().pendientesDeResolver.length).toBe(1);
      await noFiltra(r.body, a.id);
    });

    it('la respuesta del cierre no trae saldos', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const cuadre = await pedir({ method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
      const r = await pedir({
        method: 'POST',
        url: `/rondas/${rondaId}/cierre`,
        payload: {
          decisiones: cuadre.json<{ pendientes: { articuloId: string }[] }>().pendientes.map((p) => ({
            articuloId: p.articuloId,
            estado: 'no_contado' as const,
            claveIdempotencia: randomUUID(),
          })),
        },
      });

      expect(r.statusCode).toBe(201);
      await noFiltra(r.body, a.id);
    }, 60_000);
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

  // ────────────────────────────────────────────────────────────────────
  // El cuadre de cierre no es una puerta trasera al libro
  // ────────────────────────────────────────────────────────────────────

  describe('una decisión de cierre solo vale sobre un artículo pendiente', () => {
    /** Deja el artículo con una alerta de discrepancia SIN responder. */
    const conAlertaAbierta = async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      const r = await registrar(rondaId, {
        articuloId: a.id,
        // Lejos del saldo por cualquier tolerancia concebible.
        cantidad: Number(a.saldo) + 1000,
        unidadId: a.unidad_esperada_id,
      });
      expect(r.statusCode).toBe(201);
      expect(r.json<{ validacion: { resultado: string } }>().validacion.resultado).toBe(
        'alerta_discrepancia',
      );

      return { rondaId, a };
    };

    const cerrar = (rondaId: string, decisiones: unknown[]) =>
      pedir({ method: 'POST', url: `/rondas/${rondaId}/cierre`, payload: { decisiones } });

    it('FR-2.8 · el Operador no puede enterrar su propia alerta con un `no_contado`', async () => {
      const { rondaId, a } = await conAlertaAbierta();

      // El cuadre NO lo lista como pendiente —ya afirmó algo sobre él— y sí lo
      // anuncia como bloqueo. Esas dos cosas son la premisa del ataque.
      const cuadre = await pedir({ method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
      const { pendientes, bloqueos } = cuadre.json<{
        pendientes: { articuloId: string }[];
        bloqueos: { articuloId: string; motivo: string }[];
      }>();
      expect(pendientes.map((p) => p.articuloId)).not.toContain(a.id);
      expect(bloqueos).toContainEqual(
        expect.objectContaining({ articuloId: a.id, motivo: 'alerta_sin_responder' }),
      );

      // El entierro: una fila `no_contado` de mayor secuencia pasaría a ser la
      // vigente, el artículo saldría de `pendiente_de_resolver` y el cierre
      // procedería con la alerta sin responder.
      const r = await cerrar(rondaId, [
        { articuloId: a.id, estado: 'no_contado', claveIdempotencia: randomUUID() },
      ]);

      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('DECISION_NO_PENDIENTE');

      // La alerta sigue viva…
      const [pendiente] = await sql<{ motivo: string }[]>`
        SELECT motivo FROM pendiente_de_resolver
        WHERE ronda_id = ${rondaId} AND articulo_id = ${a.id}`;
      expect(pendiente?.motivo).toBe('alerta_sin_responder');

      // …y el libro no ganó ninguna fila: el vigente sigue siendo el conteo
      // advertido, que es la evidencia que el Auditor tiene que poder ver.
      const filas = await sql<{ estado: string; resultado_validacion: string | null }[]>`
        SELECT estado, resultado_validacion FROM registro_conteo
        WHERE ronda_id = ${rondaId} AND articulo_id = ${a.id} ORDER BY secuencia`;
      expect(filas).toHaveLength(1);
      expect(filas[0]!.estado).toBe('contado');
      expect(filas[0]!.resultado_validacion).toBe('alerta_discrepancia');
    });

    it('tampoco con un `contado_en_cero`: la puerta no depende del estado', async () => {
      const { rondaId, a } = await conAlertaAbierta();

      const r = await cerrar(rondaId, [
        { articuloId: a.id, estado: 'contado_en_cero', claveIdempotencia: randomUUID() },
      ]);

      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('DECISION_NO_PENDIENTE');
    });

    it('un artículo de otra bodega se rechaza con 400, no revienta con un 500', async () => {
      const rondaId = await abrirRonda();

      const [ajeno] = await sql<{ id: string }[]>`
        SELECT id FROM articulo WHERE bodega_id <> ${bodegaId} ORDER BY id LIMIT 1`;

      // Antes llegaba hasta el INSERT: violaba la clave foránea y el CHECK
      // `contado_exige_cantidad` —cero sin unidad—, y el operario veía un 500.
      const r = await cerrar(rondaId, [
        { articuloId: ajeno!.id, estado: 'contado_en_cero', claveIdempotencia: randomUUID() },
      ]);

      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('DECISION_NO_PENDIENTE');
    });

    it('dos decisiones sobre el mismo artículo en un envío se rechazan', async () => {
      const rondaId = await abrirRonda();
      const a = await unArticulo();

      // La segunda supersede a la primera: es la misma puerta con otra llave.
      // Un `contado_en_cero` que alerta, tapado acto seguido por un
      // `no_contado`, deja el artículo sin cobertura y sin rastro del cero.
      const r = await cerrar(rondaId, [
        { articuloId: a.id, estado: 'contado_en_cero', claveIdempotencia: randomUUID() },
        { articuloId: a.id, estado: 'no_contado', claveIdempotencia: randomUUID() },
      ]);

      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('DECISION_NO_PENDIENTE');

      const [n] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM registro_conteo
        WHERE ronda_id = ${rondaId} AND articulo_id = ${a.id}`;
      expect(n?.n).toBe(0);
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
