import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DespachadorService } from '../src/despacho/despacho.module';
import { ConsolidacionService } from '../src/modules/consolidacion/consolidacion.service';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Slice 3 — Historia 3: consolidación contra el saldo esperado (prueba E4).
 *
 * Atraviesa el sistema entero: un operario cierra su ronda, `captura` publica
 * `RondaCerrada` en la misma transacción, el despachador lo saca del outbox y
 * `consolidacion` —que no conoce a `captura`— reproyecta la bodega.
 *
 * Es la prueba de que el Principio IV no es un dibujo: si el evento no viajara,
 * nada de lo que se verifica aquí ocurriría.
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
  ip = `10.3.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 3 · consolidación y clasificación', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookieOperador: string;
  let cookieAuditor: string;
  let despachador: DespachadorService;
  let consolidacion: ConsolidacionService;

  const pedir = (cookie: string, opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: { cookie, 'content-type': 'application/json' },
      // El límite de tasa es por IP y las suites corren en paralelo: sin una
      // IP propia por archivo, se consumen el cupo entre ellas.
      remoteAddress: ip,
    } as never);

  const entrar = async (documento: string): Promise<string> => {
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: documento, password: 'Inventario2026*' },
      remoteAddress: '10.3.0.0',
    });
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
    consolidacion = app.get(ConsolidacionService);

    cookieOperador = await entrar('1000000001');
    cookieAuditor = await entrar('1000000002');

  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  /**
   * Espera a que el evento de ESTA bodega quede despachado.
   *
   * No basta con drenar el outbox: varias suites corren en paralelo, cada una
   * con su propio despachador, y `FOR UPDATE SKIP LOCKED` hace que el evento
   * propio se lo pueda llevar el despachador de otra —correcto en producción,
   * indeterminista en una prueba—. Se espera por la condición concreta.
   */
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

  /**
   * Cada prueba trabaja sobre una bodega propia y desechable.
   *
   * Consolidar acumula TODAS las rondas cerradas de la bodega, así que dos
   * pruebas que compartieran bodega se contaminarían: la ronda de una sería
   * "otra ronda que contradice" para la siguiente. Aislar aquí es más barato
   * que razonar sobre el orden de ejecución.
   */
  const bodegaAislada = async (
    articulos: readonly { nombre: string; saldo: string | null }[],
  ): Promise<{ bodegaId: string; ids: string[] }> => {
    const id = randomUUID();
    const [unidad] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;

    await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`E4-${id.slice(0, 8)}`}, 'Bodega de prueba E4')`;
    await sql`
      INSERT INTO usuario_bodega (usuario_id, bodega_id)
      SELECT id, ${id} FROM usuario WHERE documento IN ('1000000001', '1000000002')`;

    const ids: string[] = [];
    for (const a of articulos) {
      const articuloId = randomUUID();
      ids.push(articuloId);
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
        VALUES (${articuloId}, ${id}, ${a.nombre}, ${a.nombre.toLowerCase()}, ${unidad!.id})`;
      if (a.saldo !== null) {
        await sql`
          INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
          VALUES (${id}, ${articuloId}, ${a.saldo}, ${unidad!.id})`;
      }
    }

    return { bodegaId: id, ids };
  };

  /** Ronda completa: abre, cuenta lo que se le indique, decide el resto y cierra. */
  const rondaCompleta = async (
    bodega: string,
    conteos: ReadonlyMap<string, number | null>,
    cookie = cookieOperador,
  ): Promise<string> => {
    const abrir = await pedir(cookie, { method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
    expect(abrir.statusCode).toBe(201);
    const rondaId = abrir.json<{ rondaId: string }>().rondaId;

    const [unidad] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;

    for (const [articuloId, cantidad] of conteos) {
      if (cantidad === null) continue;
      const r = await pedir(cookie, {
        method: 'POST',
        url: `/rondas/${rondaId}/registros`,
        payload: {
          articuloId, cantidad, unidadId: unidad!.id, estado: 'contado',
          modoCaptura: 'texto', origenParse: 'manual', origenNombre: 'exacto',
          capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
          // La alerta se sostiene: aquí interesa qué concluye la consolidación
          // sobre una diferencia, no volver a probar el flujo de la alerta.
          confirmaPeseAAlerta: true,
        },
      });
      expect(r.statusCode).toBe(201);
    }

    const cuadre = await pedir(cookie, { method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
    const { pendientes } = cuadre.json<{ pendientes: { articuloId: string }[] }>();

    const cierre = await pedir(cookie, {
      method: 'POST',
      url: `/rondas/${rondaId}/cierre`,
      payload: {
        decisiones: pendientes.map((p) => ({
          articuloId: p.articuloId, estado: 'no_contado', claveIdempotencia: randomUUID(),
        })),
      },
    });
    expect(cierre.statusCode).toBe(201);

    // El evento viaja por el outbox, igual que en producción.
    await drenar(bodega);
    return rondaId;
  };

  const consolidadoDe = async (bodega: string, articuloId: string) => {
    const [c] = await sql<
      { clasificacion: string; motivo_auditable: string | null; valor_final: string | null; rondas_afirmando: number; origen_valor: string | null }[]
    >`
      SELECT clasificacion, motivo_auditable, valor_final, rondas_afirmando, origen_valor
      FROM articulo_consolidado WHERE bodega_id = ${bodega} AND articulo_id = ${articuloId}`;
    return c;
  };

  // ────────────────────────────────────────────────────────────────────
  // E4 · La clasificación, extremo a extremo
  // ────────────────────────────────────────────────────────────────────

  describe('E4 · una sola ronda basta (D5)', () => {
    it('el conteo que coincide con el saldo esperado queda conciliado', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'ARTICULO A', saldo: '40.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 40]]));

      const c = await consolidadoDe(b, ids[0]!);
      expect(c).toMatchObject({ clasificacion: 'conciliado', motivo_auditable: null, origen_valor: 'conteo_ciego' });
      expect(Number(c!.valor_final)).toBe(40);
      expect(c!.rondas_afirmando).toBe(1);
    });

    it('el conteo con diferencia queda auditable por discrepancia', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'ARTICULO B', saldo: '40.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 12]]));

      expect(await consolidadoDe(b, ids[0]!))
        .toMatchObject({ clasificacion: 'auditable', motivo_auditable: 'discrepancia', valor_final: null });
    });

    it('el artículo que ninguna ronda afirmó queda sin cobertura', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([
        { nombre: 'CONTADO', saldo: '10.000' },
        { nombre: 'IGNORADO', saldo: '10.000' },
      ]);
      await rondaCompleta(b, new Map([[ids[0]!, 10]]));

      expect((await consolidadoDe(b, ids[1]!))!.motivo_auditable).toBe('sin_cobertura');
    });

    it('el artículo sin saldo esperado nunca concilia', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'SIN SALDO', saldo: null }]);
      await rondaCompleta(b, new Map([[ids[0]!, 7]]));

      expect((await consolidadoDe(b, ids[0]!))!.motivo_auditable).toBe('sin_saldo_esperado');
    });
  });

  describe('E4 · dos rondas', () => {
    it('dos rondas que se contradicen: auditable, y el sistema NO elige', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'DISPUTADO', saldo: '40.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 40]]));
      await rondaCompleta(b, new Map([[ids[0]!, 38]]));

      const c = await consolidadoDe(b, ids[0]!);
      expect(c).toMatchObject({ clasificacion: 'auditable', motivo_auditable: 'contradiccion_entre_rondas' });
      // Ninguna de las dos cifras se impone.
      expect(c!.valor_final).toBeNull();
      expect(c!.rondas_afirmando).toBe(2);
    });

    it('dos rondas que coinciden entre sí y con el sistema: conciliado', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'ACORDADO', saldo: '25.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 25]]));
      await rondaCompleta(b, new Map([[ids[0]!, 25]]));

      const c = await consolidadoDe(b, ids[0]!);
      expect(c!.clasificacion).toBe('conciliado');
      expect(c!.rondas_afirmando).toBe(2);
    });

    it('basta con que UNA ronda haya producido diferencia (FR-3.10)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'UNA FALLA', saldo: '30.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 30]]));
      // La segunda ronda coincide con el saldo, pero la primera ya... no: aquí
      // la primera coincide y la segunda difiere. El resultado es el mismo.
      await rondaCompleta(b, new Map([[ids[0]!, 3]]));

      expect((await consolidadoDe(b, ids[0]!))!.clasificacion).toBe('auditable');
    });

    it('una segunda ronda cerrada RECLASIFICA lo que ya estaba conciliado', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CAMBIA', saldo: '15.000' }]);

      await rondaCompleta(b, new Map([[ids[0]!, 15]]));
      expect((await consolidadoDe(b, ids[0]!))!.clasificacion).toBe('conciliado');

      // Consolidar es acumular TODAS las rondas: la nueva no se suma a la
      // conclusión anterior, la reemplaza.
      await rondaCompleta(b, new Map([[ids[0]!, 9]]));
      expect((await consolidadoDe(b, ids[0]!))!.clasificacion).toBe('auditable');
    });
  });

  describe('E4 · el libro no se toca (FR-3.8, escenario 8, escenario 10)', () => {
    it('cada ronda conserva su autor, su momento y su cantidad', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CON HISTORIA', saldo: '20.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 20]]));
      await rondaCompleta(b, new Map([[ids[0]!, 18]]));

      const r = await pedir(cookieAuditor, {
        method: 'GET', url: `/bodegas/${b}/articulos/${ids[0]}/rondas`,
      });

      const { rondas } = r.json<{ rondas: { operador: string; cantidad: string }[] }>();
      expect(rondas).toHaveLength(2);
      expect(rondas.map((x) => Number(x.cantidad))).toEqual([20, 18]);
      expect(rondas.every((x) => x.operador === 'Operador de Prueba')).toBe(true);
    });

    it('consolidar toma el vigente e ignora los superseded, que siguen ahí', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CORREGIDO', saldo: '50.000' }]);
      const [unidad] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;

      const abrir = await pedir(cookieOperador, { method: 'POST', url: '/rondas', payload: { bodegaId: b } });
      const rondaId = abrir.json<{ rondaId: string }>().rondaId;

      const enviar = (cantidad: number, extra: Record<string, unknown> = {}) =>
        pedir(cookieOperador, {
          method: 'POST',
          url: `/rondas/${rondaId}/registros`,
          payload: {
            articuloId: ids[0], cantidad, unidadId: unidad!.id, estado: 'contado',
            modoCaptura: 'texto', origenParse: 'manual', origenNombre: 'exacto',
            capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(), ...extra,
          },
        });

      await enviar(5);                                   // se equivoca…
      await enviar(50, { confirmaCorreccion: true });    // …y corrige al valor real

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
      await despachador.pasada();

      // El vigente coincide con el sistema: concilia. La corrección ES la
      // respuesta a la alerta, no una diferencia que arrastrar (FR-3.6).
      expect((await consolidadoDe(b, ids[0]!))!.clasificacion).toBe('conciliado');

      // Y el intento equivocado sigue en la traza, sin haberse tocado.
      const filas = await sql<{ cantidad: string }[]>`
        SELECT cantidad FROM registro_conteo
        WHERE ronda_id = ${rondaId} AND articulo_id = ${ids[0]!} ORDER BY secuencia`;
      expect(filas.map((f) => Number(f.cantidad))).toEqual([5, 50]);
    });
  });

  describe('E4 · la proyección se puede tirar y regenerar (H3-05)', () => {
    it('reconstruir desde el libro da EXACTAMENTE el mismo consolidado', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([
        { nombre: 'UNO', saldo: '10.000' },
        { nombre: 'DOS', saldo: '20.000' },
        { nombre: 'TRES', saldo: null },
      ]);
      await rondaCompleta(b, new Map([[ids[0]!, 10], [ids[1]!, 3]]));

      const proyeccion = () => sql<Record<string, unknown>[]>`
        SELECT articulo_id, clasificacion, motivo_auditable, valor_final, rondas_afirmando
        FROM articulo_consolidado WHERE bodega_id = ${b} ORDER BY articulo_id`;

      const antes = [...(await proyeccion())];

      // Se borra la proyección entera. Si el libro es de verdad la fuente de
      // verdad, esto no puede perder nada.
      await sql`DELETE FROM articulo_consolidado WHERE bodega_id = ${b}`;
      await sql.begin((trx) => consolidacion.reproyectar(trx, b));

      expect([...(await proyeccion())]).toEqual(antes);
    });

    it('reproyectar dos veces no cambia nada: es idempotente', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'IDEM', saldo: '8.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 8]]));

      await sql.begin((trx) => consolidacion.reproyectar(trx, b));
      await sql.begin((trx) => consolidacion.reproyectar(trx, b));

      const [abiertas] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM discrepancia WHERE bodega_id = ${b} AND estado <> 'cerrada'`;
      expect(abiertas!.n).toBe(0);
      expect((await consolidadoDe(b, ids[0]!))!.clasificacion).toBe('conciliado');
    });
  });

  describe('E4 · la bandeja y el cierre', () => {
    it('la bandeja del Auditor trae SOLO lo auditable (FR-4.1)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([
        { nombre: 'BIEN', saldo: '5.000' },
        { nombre: 'MAL', saldo: '5.000' },
      ]);
      await rondaCompleta(b, new Map([[ids[0]!, 5], [ids[1]!, 500]]));

      const r = await pedir(cookieAuditor, { method: 'GET', url: `/bodegas/${b}/auditables` });
      const { items } = r.json<{ items: { articuloId: string; motivo: string }[] }>();

      expect(items.map((i) => i.articuloId)).toEqual([ids[1]]);
    });

    it('el Operador NO puede leer el consolidado: ahí vive la diferencia', async () => {
      const { bodegaId: b } = await bodegaAislada([{ nombre: 'X', saldo: '1.000' }]);
      const r = await pedir(cookieOperador, { method: 'GET', url: `/bodegas/${b}/consolidado` });
      expect(r.statusCode).toBe(403);
    });

    it('sin ninguna ronda cerrada, el inventario no se puede cerrar (FR-3.7)', async () => {
      const { bodegaId: b } = await bodegaAislada([{ nombre: 'VACIA', saldo: '1.000' }]);

      await expect(consolidacion.verificarCierrePosible(b)).rejects.toMatchObject({
        response: { codigo: 'SIN_RONDAS_CERRADAS' },
      });
    });

    it('con una ronda cerrada, sí', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'LISTA', saldo: '2.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 2]]));

      await expect(consolidacion.verificarCierrePosible(b)).resolves.toBeUndefined();
    });

    it('el resumen cuenta lo que hay que contar', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([
        { nombre: 'A', saldo: '3.000' },
        { nombre: 'B', saldo: '3.000' },
        { nombre: 'C', saldo: '3.000' },
      ]);
      await rondaCompleta(b, new Map([[ids[0]!, 3], [ids[1]!, 99]]));

      const r = await pedir(cookieAuditor, { method: 'GET', url: `/bodegas/${b}/consolidado` });
      expect(r.json()).toMatchObject({
        conciliados: 1,
        auditables: 2,
        rondasCerradas: 1,
        total: 3,
        porMotivo: { discrepancia: 1, sin_cobertura: 1 },
      });
    });
  });
});
