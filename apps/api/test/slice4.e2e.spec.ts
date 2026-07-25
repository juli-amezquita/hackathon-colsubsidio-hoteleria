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
 * Slice 4 — Historia 4: reconteo del Auditor (prueba E5).
 *
 * Cierra el ciclo de control: es lo que convierte el conteo en un dato del que
 * alguien responde. Y es la superficie donde el saldo esperado SÍ se muestra,
 * así que media prueba consiste en verificar que un Operador no llega a ella.
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
  ip = `10.4.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 4 · reconteo del Auditor', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookieOperador: string;
  let cookieAuditor: string;
  let despachador: DespachadorService;
  let consolidacion: ConsolidacionService;
  let unidadId: string;

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
      remoteAddress: '10.4.0.0',
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

    const [u] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;
    unidadId = u!.id;
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

  const bodegaAislada = async (
    articulos: readonly { nombre: string; saldo: string | null }[],
  ): Promise<{ bodegaId: string; ids: string[] }> => {
    const id = randomUUID();
    await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`E5-${id.slice(0, 8)}`}, 'Bodega de prueba E5')`;
    await sql`
      INSERT INTO usuario_bodega (usuario_id, bodega_id)
      SELECT id, ${id} FROM usuario WHERE documento IN ('1000000001', '1000000002')`;

    const ids: string[] = [];
    for (const a of articulos) {
      const articuloId = randomUUID();
      ids.push(articuloId);
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
        VALUES (${articuloId}, ${id}, ${a.nombre}, ${a.nombre.toLowerCase()}, ${unidadId})`;
      if (a.saldo !== null) {
        await sql`
          INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
          VALUES (${id}, ${articuloId}, ${a.saldo}, ${unidadId})`;
      }
    }
    return { bodegaId: id, ids };
  };

  const rondaCompleta = async (
    bodega: string,
    conteos: ReadonlyMap<string, number>,
    cookie = cookieOperador,
  ): Promise<void> => {
    const abrir = await pedir(cookie, { method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
    expect(abrir.statusCode, `abrir ronda: ${abrir.body.slice(0, 200)}`).toBe(201);
    const rondaId = abrir.json<{ rondaId: string }>().rondaId;

    for (const [articuloId, cantidad] of conteos) {
      await pedir(cookie, {
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

    const cuadre = await pedir(cookie, { method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
    await pedir(cookie, {
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

  const recontar = (bodega: string, articuloId: string, cantidad: number, razon = 'ERROR_CONTEO', cookie = cookieAuditor) =>
    pedir(cookie, {
      method: 'POST',
      url: `/auditoria/bodegas/${bodega}/articulos/${articuloId}/reconteo`,
      payload: {
        cantidad, unidadId, codigoRazonId: razon, modoCaptura: 'voz',
        capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
      },
    });

  // ────────────────────────────────────────────────────────────────────
  // E5 · Lo que el Auditor ve, y lo que el Operador nunca puede ver
  // ────────────────────────────────────────────────────────────────────

  describe('E5 · la frontera del rol (FR-4.9, FR-1.18)', () => {
    it('el Operador recibe 403 en TODA la superficie de auditoría', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'VEDADO', saldo: '10.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 2]]));

      const rutas = [
        { method: 'GET', url: '/auditoria/codigos-razon' },
        { method: 'GET', url: `/auditoria/bodegas/${b}/pendientes` },
        { method: 'GET', url: `/auditoria/bodegas/${b}/articulos/${ids[0]}` },
        { method: 'POST', url: `/auditoria/bodegas/${b}/articulos/${ids[0]}/reconteo`, payload: {} },
      ];

      for (const ruta of rutas) {
        const r = await pedir(cookieOperador, ruta);
        expect(r.statusCode, `${ruta.method} ${ruta.url} no rechazó al Operador`).toBe(403);
      }
    });

    it('el Auditor SÍ ve el saldo esperado y la diferencia (FR-4.2)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CON DIFERENCIA', saldo: '30.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 12]]));

      const r = await pedir(cookieAuditor, { method: 'GET', url: `/auditoria/bodegas/${b}/articulos/${ids[0]}` });
      expect(r.statusCode).toBe(200);

      const caso = r.json<{ saldoEsperado: string; rondas: { cantidad: string; diferencia: string }[] }>();
      expect(Number(caso.saldoEsperado)).toBe(30);
      expect(Number(caso.rondas[0]!.diferencia)).toBe(-18);
    });
  });

  describe('E5 · el caso ordenado', () => {
    it('muestra cuánto contó cada persona y en qué ronda (escenario 3)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'DISPUTADO', saldo: '20.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 20]]));
      await rondaCompleta(b, new Map([[ids[0]!, 14]]));

      const caso = (await pedir(cookieAuditor, { method: 'GET', url: `/auditoria/bodegas/${b}/articulos/${ids[0]}` }))
        .json<{ motivo: string; rondas: { operador: string; cantidad: string }[] }>();

      expect(caso.motivo).toBe('contradiccion_entre_rondas');
      expect(caso.rondas.map((x) => Number(x.cantidad))).toEqual([20, 14]);
    });

    it('el árbitro ORDENA la evidencia y NO emite veredicto (H4-05)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'PARA ARBITRAR', saldo: '100.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 40]]));

      const caso = (await pedir(cookieAuditor, { method: 'GET', url: `/auditoria/bodegas/${b}/articulos/${ids[0]}` }))
        .json<{ sintesis: { relato: string; observaciones: string[]; preguntas: string[]; razonesPlausibles: string[] } }>();

      expect(caso.sintesis.relato).toContain('Operador de Prueba');
      expect(caso.sintesis.preguntas.length).toBeGreaterThan(0);
      expect(caso.sintesis.razonesPlausibles).toContain('ERROR_CONTEO');

      // La forma de la salida es la garantía: no hay dónde poner un veredicto
      // ni una cantidad sugerida. Si alguien los añadiera, esto falla.
      const campos = Object.keys(caso.sintesis).sort();
      expect(campos).toEqual(['observaciones', 'preguntas', 'razonesPlausibles', 'relato']);
    });

    it('la diferencia contra el sistema aparece en la síntesis, no la respuesta', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'NEGATIVO', saldo: '-8.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 3]]));

      const caso = (await pedir(cookieAuditor, { method: 'GET', url: `/auditoria/bodegas/${b}/articulos/${ids[0]}` }))
        .json<{ sintesis: { observaciones: string[] } }>();

      // El archivo real trae 79 saldos negativos y son una anomalía del sistema
      // central que el Auditor debe conocer antes de subir a mirar el estante.
      expect(caso.sintesis.observaciones.join(' ')).toContain('NEGATIVO');
    });
  });

  describe('E5 · el reconteo', () => {
    it('exige un código de razón del catálogo controlado (FR-4.4)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'SIN CAUSA', saldo: '9.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 1]]));

      const inventada = await recontar(b, ids[0]!, 5, 'PORQUE_SI');
      expect(inventada.statusCode).toBe(400);
      expect(inventada.json<{ codigo: string }>().codigo).toBe('RAZON_NO_VALIDA');

      const sinRazon = await pedir(cookieAuditor, {
        method: 'POST',
        url: `/auditoria/bodegas/${b}/articulos/${ids[0]}/reconteo`,
        payload: { cantidad: 5, unidadId, modoCaptura: 'voz', capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID() },
      });
      expect(sinRazon.statusCode).toBe(400);
    });

    it('el valor del Auditor PREVALECE sobre el de los Operadores (FR-4.5)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'PREVALECE', saldo: '50.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 20]]));

      expect((await recontar(b, ids[0]!, 47, 'MERMA')).statusCode).toBe(201);

      const [c] = await sql<{ valor_final: string; origen_valor: string }[]>`
        SELECT valor_final, origen_valor FROM articulo_consolidado
        WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(Number(c!.valor_final)).toBe(47);
      expect(c!.origen_valor).toBe('auditor');
    });

    it('y SOBREVIVE a reproyectar la bodega entera', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'SOBREVIVE', saldo: '50.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 20]]));
      await recontar(b, ids[0]!, 47, 'MERMA');

      // Si el reconteo solo se escribiera al recontar, la primera ronda que
      // cerrara después lo borraría sin que nadie lo notara.
      await sql.begin((trx) => consolidacion.reproyectar(trx, b));

      const [c] = await sql<{ valor_final: string; origen_valor: string }[]>`
        SELECT valor_final, origen_valor FROM articulo_consolidado
        WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(Number(c!.valor_final)).toBe(47);
      expect(c!.origen_valor).toBe('auditor');
    });

    it('cero es una respuesta válida: "fui, miré, no está" (escenario 6)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'NO ESTA', saldo: '15.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 15]]));
      // Se fuerza a auditable con una segunda ronda que contradice.
      await rondaCompleta(b, new Map([[ids[0]!, 4]]));

      expect((await recontar(b, ids[0]!, 0, 'FALTANTE')).statusCode).toBe(201);

      const [c] = await sql<{ valor_final: string }[]>`
        SELECT valor_final FROM articulo_consolidado WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(Number(c!.valor_final)).toBe(0);
    });

    it('corregirse SUPERSEDE, no sobrescribe (FR-4.6)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CORRIGE', saldo: '12.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 3]]));

      await recontar(b, ids[0]!, 10, 'ERROR_CONTEO');
      await recontar(b, ids[0]!, 11, 'ERROR_CONTEO');

      const filas = await sql<{ secuencia: number; cantidad: string }[]>`
        SELECT secuencia, cantidad FROM reconteo
        WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!} ORDER BY secuencia`;

      expect(filas.map((f) => Number(f.cantidad))).toEqual([10, 11]);

      const [c] = await sql<{ valor_final: string }[]>`
        SELECT valor_final FROM articulo_consolidado WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(Number(c!.valor_final)).toBe(11);
    });

    it('reenviar el mismo sobre no duplica el reconteo', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'IDEMPOTENTE', saldo: '6.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 1]]));

      const sobre = {
        cantidad: 5, unidadId, codigoRazonId: 'MERMA', modoCaptura: 'voz' as const,
        capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
      };
      const url = `/auditoria/bodegas/${b}/articulos/${ids[0]}/reconteo`;

      const uno = await pedir(cookieAuditor, { method: 'POST', url, payload: sobre });
      const dos = await pedir(cookieAuditor, { method: 'POST', url, payload: sobre });

      expect(dos.json<{ reconteoId: string }>().reconteoId).toBe(uno.json<{ reconteoId: string }>().reconteoId);

      const [reconteos] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM reconteo WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(reconteos!.n).toBe(1);
    });

    it('un artículo SIN COBERTURA lo resuelve el Auditor sin otra ronda (escenario 9)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([
        { nombre: 'CONTADO', saldo: '4.000' },
        { nombre: 'JAMAS CONTADO', saldo: '4.000' },
      ]);
      await rondaCompleta(b, new Map([[ids[0]!, 4]]));

      const [antes] = await sql<{ motivo_auditable: string }[]>`
        SELECT motivo_auditable FROM articulo_consolidado WHERE bodega_id = ${b} AND articulo_id = ${ids[1]!}`;
      expect(antes!.motivo_auditable).toBe('sin_cobertura');

      expect((await recontar(b, ids[1]!, 4, 'ERROR_CONTEO')).statusCode).toBe(201);

      const pendientes = (await pedir(cookieAuditor, { method: 'GET', url: `/auditoria/bodegas/${b}/pendientes` }))
        .json<{ items: { articuloId: string }[] }>();
      expect(pendientes.items.map((i) => i.articuloId)).not.toContain(ids[1]);
    });
  });

  describe('E5 · independencia y cierre', () => {
    it('señala en la traza que el Auditor contó una ronda de esta bodega (FR-4.7)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CONFLICTO', saldo: '7.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 2]]));

      // Una ronda de esta bodega atribuida al propio Auditor.
      //
      // Se inserta directamente porque abrir rondas es del rol Operador y el
      // rol es único por usuario: en la vida real este caso llega cuando la
      // misma persona contó antes de que le cambiaran el rol, o cuando el
      // parque manda a auditar a quien tenía a mano. La fila existe igual, y
      // es lo que el sistema tiene que detectar.
      const [auditor] = await sql<{ id: string }[]>`SELECT id FROM usuario WHERE documento = '1000000002'`;
      const rondaPropia = randomUUID();
      await sql`
        INSERT INTO ronda (id, bodega_id, operador_id) VALUES (${rondaPropia}, ${b}, ${auditor!.id})`;
      await sql`
        INSERT INTO ronda_cierre (ronda_id, cerrada_por) VALUES (${rondaPropia}, ${auditor!.id})`;

      const r = await recontar(b, ids[0]!, 7, 'ERROR_CONTEO');
      expect(r.json<{ conflictoIndependencia: boolean }>().conflictoIndependencia).toBe(true);

      // No se prohíbe: se registra. Prohibirlo pararía el inventario.
      const [fila] = await sql<{ conflicto_independencia: boolean }[]>`
        SELECT conflicto_independencia FROM reconteo WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;
      expect(fila!.conflicto_independencia).toBe(true);
    });

    it('no lo señala cuando el Auditor no contó nada en esa bodega', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'LIMPIO', saldo: '7.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 2]]));

      const r = await recontar(b, ids[0]!, 7, 'ERROR_CONTEO');
      expect(r.json<{ conflictoIndependencia: boolean }>().conflictoIndependencia).toBe(false);
    });

    it('el inventario NO cierra con auditables pendientes (FR-4.8)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'PENDIENTE', saldo: '11.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 1]]));

      await expect(consolidacion.verificarCierrePosible(b)).rejects.toMatchObject({
        response: { codigo: 'AUDITABLES_PENDIENTES' },
      });
    });

    it('y sí cierra cuando el Auditor los resolvió todos', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'RESUELTO', saldo: '11.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 1]]));
      await recontar(b, ids[0]!, 11, 'ERROR_CONTEO');

      await expect(consolidacion.verificarCierrePosible(b)).resolves.toBeUndefined();
    });

    it('un caso cerrado NO se reabre al reproyectar la bodega', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'NO REABRE', saldo: '3.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 1]]));
      await recontar(b, ids[0]!, 3, 'MERMA');

      await sql.begin((trx) => consolidacion.reproyectar(trx, b));

      // Reabrirlo desharía la decisión del Auditor sin que nadie la revocara.
      const [abiertas] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM discrepancia WHERE bodega_id = ${b} AND estado <> 'cerrada'`;
      expect(abiertas!.n).toBe(0);
    });

    it('el 100% de los casos cerrados tiene su código de razón (SC-4.2)', async () => {
      const { bodegaId: b, ids } = await bodegaAislada([{ nombre: 'CON CAUSA', saldo: '5.000' }]);
      await rondaCompleta(b, new Map([[ids[0]!, 1]]));
      await recontar(b, ids[0]!, 5, 'DETERIORO');

      const [d] = await sql<{ estado: string; codigo_razon_id: string; cerrada_en: Date }[]>`
        SELECT estado, codigo_razon_id, cerrada_en FROM discrepancia
        WHERE bodega_id = ${b} AND articulo_id = ${ids[0]!}`;

      expect(d).toMatchObject({ estado: 'cerrada', codigo_razon_id: 'DETERIORO' });
      expect(d!.cerrada_en).not.toBeNull();
    });
  });
});
