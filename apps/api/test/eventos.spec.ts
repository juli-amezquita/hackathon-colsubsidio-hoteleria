import { randomUUID } from 'node:crypto';

import type { Evento } from '@cci/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Consumidor } from '../src/platform/eventos/bus';
import { DespachadorOutbox } from '../src/platform/eventos/despachador';
import { OutboxBus } from '../src/platform/eventos/outbox';
import { opcionesSsl } from '../src/platform/db/ssl';

/**
 * F-12 · Las dos garantías del Principio IV, probadas contra la base real.
 *
 *   1. Si el consumidor falla, el evento SOBREVIVE.
 *   2. Si llega dos veces, el efecto ocurre UNA sola vez.
 *
 * Sin esto, "el sistema es consistente" es una afirmación sin respaldo.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

/** ¿El evento es de esta suite? El despachador entrega todo lo pendiente. */
const esMio = (evento: Evento, bodegaId: string): boolean =>
  (evento.payload as { bodegaId?: string }).bodegaId === bodegaId;

function eventoDePrueba(bodegaId: string, articuloId: string) {
  return {
    tipo: 'ConteoRegistrado' as const,
    payload: {
      rondaId: randomUUID(),
      bodegaId,
      articuloId,
      secuencia: 1,
      estado: 'contado' as const,
      cantidad: 7,
      unidadId: randomUUID(),
      modoCaptura: 'voz' as const,
    },
    actorId: null,
  };
}

describe('F-10/F-11/F-12 · outbox y despacho', () => {
  let sql: postgres.Sql;
  let bus: OutboxBus;
  let bodegaId: string;
  let articuloId: string;
  /** Momento en que arrancó la suite: separa lo suyo de lo heredado. */
  const arranque = new Date();

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 4, ssl: opcionesSsl(), onnotice: () => {} });
    bus = new OutboxBus();

    // ⚠️ Bodega PROPIA, y todo lo que sigue se filtra por ella.
    //
    // Esta suite borraba el outbox entero entre pruebas. Con las suites de los
    // slices corriendo en paralelo contra la misma base, eso no solo hacía
    // inestables sus propias cuentas: **le borraba eventos pendientes a las
    // demás**, que fallaban después por una causa imposible de relacionar con
    // este archivo.
    bodegaId = randomUUID();
    await sql`
      INSERT INTO bodega (id, codigo, nombre)
      VALUES (${bodegaId}, ${`EVT-${bodegaId.slice(0, 8)}`}, 'Bodega de pruebas de eventos')`;

    const [u] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida LIMIT 1`;
    articuloId = randomUUID();
    await sql`
      INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
      VALUES (${articuloId}, ${bodegaId}, 'ARTICULO DE EVENTOS', 'articulo de eventos', ${u!.id})`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      DELETE FROM evento_procesado WHERE event_id IN (
        SELECT id FROM outbox WHERE payload->>'bodegaId' = ${bodegaId})`;
    await sql`DELETE FROM outbox WHERE payload->>'bodegaId' = ${bodegaId}`;

    // Se dan por despachados los eventos anteriores a esta suite.
    //
    // `pasada()` toma un lote acotado, los más antiguos primero. En pruebas el
    // despachador de fondo está apagado —a propósito— así que los eventos de
    // corridas anteriores se acumulan, y con suficientes por delante el evento
    // de ESTA prueba nunca entraría en el lote. Es una prueba que fallaría por
    // la edad de la base, no por el código.
    await sql`
      UPDATE outbox SET despachado_en = now()
      WHERE despachado_en IS NULL AND ocurrido_en < ${arranque}`;
  });

  it('escribe el evento en la MISMA transacción que su causa', async () => {
    // Si la transacción se deshace, el evento tampoco queda. Ese es el punto:
    // dato y evento viven o mueren juntos.
    await expect(
      sql.begin(async (trx) => {
        await bus.publicar(trx, eventoDePrueba(bodegaId, articuloId));
        throw new Error('fallo simulado después de publicar');
      }),
    ).rejects.toThrow(/fallo simulado/);

    const [f] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM outbox WHERE payload->>'bodegaId' = ${bodegaId}`;
    expect(f?.n).toBe(0);
  });

  it('rechaza un evento cuyo payload no corresponde a su tipo', async () => {
    await expect(
      sql.begin(async (trx) => {
        // @ts-expect-error el payload es deliberadamente inválido
        await bus.publicar(trx, { tipo: 'ConteoRegistrado', payload: { nada: true } });
      }),
    ).rejects.toThrow();
  });

  it('si el consumidor falla, el evento NO se marca como despachado', async () => {
    await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));

    const roto: Consumidor = {
      nombre: 'consumidor-roto',
      interesadoEn: ['ConteoRegistrado'],
      manejar: () => Promise.reject(new Error('el consumidor explotó')),
    };

    const d = new DespachadorOutbox(sql, [roto]);
    await expect(d.pasada()).rejects.toThrow(/explotó/);

    const [f] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM outbox
      WHERE despachado_en IS NULL AND payload->>'bodegaId' = ${bodegaId}`;
    expect(f?.n).toBe(1); // sigue pendiente: se reintentará

    // Y la marca de procesado tampoco quedó: iba en la misma transacción.
    const [p] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM evento_procesado WHERE event_id IN (
        SELECT id FROM outbox WHERE payload->>'bodegaId' = ${bodegaId})`;
    expect(p?.n).toBe(0);
  });

  it('una pasada fallida en el temporizador NO tumba el proceso', async () => {
    // La garantía del outbox es "si algo falla, vuelve en la siguiente pasada".
    // Eso exige que haya siguiente pasada.
    //
    // El temporizador corre sin nadie esperando la promesa, así que un rechazo
    // sin capturar es un `unhandledRejection`, y Node responde a eso matando el
    // proceso: un corte de red al ERP dejaría la API abajo y el outbox sin
    // vaciar. La prueba mira que el fallo se reporte y que el despachador siga
    // trabajando después.
    await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));

    let intentos = 0;
    const inestable: Consumidor = {
      nombre: 'consumidor-inestable',
      interesadoEn: ['ConteoRegistrado'],
      manejar: (_trx, evento) => {
        if (!esMio(evento, bodegaId)) return Promise.resolve();
        intentos += 1;
        // Falla la primera vez, funciona la segunda: es la forma de un corte
        // de red, no la de un error de programación.
        return intentos === 1 ? Promise.reject(new Error('corte de red')) : Promise.resolve();
      },
    };

    const fallos: Error[] = [];
    const d = new DespachadorOutbox(sql, [inestable], 20, 50, (e) => fallos.push(e));

    d.iniciar();
    // Se espera a que OCURRA, no un tiempo fijo.
    //
    // La versión anterior dormía 400 ms y daba por hecho que con 20 ms de
    // intervalo daba de sobra. Casi siempre sí; una de cada varias corridas, no
    // — y una prueba que falla a veces por el reloj de la máquina enseña al
    // equipo a reintentar el CI en vez de leerlo.
    const limite = Date.now() + 5000;
    while (intentos < 2 && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 20));
    }
    d.detener();

    // Al detener, una pasada puede quedar a medias: el guarda `corriendo` hace
    // que una llamada inmediata devuelva 0 sin hacer nada. Se insiste hasta que
    // el evento quede despachado o se agote el plazo.
    const finalizado = async (): Promise<boolean> => {
      const [f] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM outbox
        WHERE despachado_en IS NULL AND payload->>'bodegaId' = ${bodegaId}`;
      return (f?.n ?? 1) === 0;
    };
    const hasta = Date.now() + 5000;
    while (!(await finalizado()) && Date.now() < hasta) {
      await d.pasada().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 20));
    }

    // Falló, se reportó —no se lo tragó en silencio— y volvió a intentarlo.
    expect(fallos.length).toBeGreaterThanOrEqual(1);
    expect(fallos[0]?.message).toMatch(/corte de red/);
    expect(intentos).toBeGreaterThanOrEqual(2);

    // Y el segundo intento sí lo despachó.
    const [f] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM outbox
      WHERE despachado_en IS NULL AND payload->>'bodegaId' = ${bodegaId}`;
    expect(f?.n).toBe(0);
  });

  it('entregado dos veces, el efecto ocurre UNA sola vez', async () => {
    await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));

    let efectos = 0;
    const contador: Consumidor = {
      nombre: 'consumidor-contador',
      interesadoEn: ['ConteoRegistrado'],
      manejar: (_trx, evento) => {
        if (esMio(evento, bodegaId)) efectos += 1;
        return Promise.resolve();
      },
    };

    const d = new DespachadorOutbox(sql, [contador]);
    await d.pasada();
    expect(efectos).toBe(1);

    // Se fuerza la reentrega, como si el despachador hubiera muerto justo
    // después de aplicar el efecto pero antes de marcar el evento.
    await sql`UPDATE outbox SET despachado_en = NULL WHERE payload->>'bodegaId' = ${bodegaId}`;
    await d.pasada();

    expect(efectos).toBe(1); // el efecto NO se repitió
  });

  it('solo entrega a los consumidores interesados en ese tipo', async () => {
    await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));

    const recibidos: string[] = [];
    const mk = (nombre: string, tipos: Evento['tipo'][]): Consumidor => ({
      nombre,
      interesadoEn: tipos,
      manejar: (_trx, evento) => {
        if (esMio(evento, bodegaId)) recibidos.push(nombre);
        return Promise.resolve();
      },
    });

    const d = new DespachadorOutbox(sql, [
      mk('si', ['ConteoRegistrado']),
      mk('no', ['InventarioCerrado']),
    ]);
    await d.pasada();

    expect(recibidos).toEqual(['si']);
  });

  it('dos despachadores en paralelo no entregan el mismo evento dos veces', async () => {
    // FOR UPDATE SKIP LOCKED: es lo que permite que varias réplicas despachen
    // a la vez sin coordinarse.
    for (let i = 0; i < 5; i += 1) {
      await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));
    }

    // Lo que se verifica es que NINGÚN evento se entregue dos veces, no que se
    // entreguen exactamente cinco: en producción hay más de un despachador
    // vivo —y en esta suite también, porque las demás pruebas levantan la
    // aplicación—, así que parte del lote puede llevárselo otro. Eso es
    // correcto. Lo que sería un fallo es que el mismo evento llegue dos veces.
    const entregados: string[] = [];
    const c = (nombre: string): Consumidor => ({
      nombre,
      interesadoEn: ['ConteoRegistrado'],
      manejar: (_trx, evento) => {
        if (esMio(evento, bodegaId)) entregados.push(evento.eventId);
        return Promise.resolve();
      },
    });

    await Promise.all([
      new DespachadorOutbox(sql, [c('compartido')]).pasada(),
      new DespachadorOutbox(sql, [c('compartido')]).pasada(),
    ]);

    // `FOR UPDATE SKIP LOCKED` es lo que permite que varias réplicas despachen
    // a la vez sin coordinarse y sin pisarse.
    expect(new Set(entregados).size).toBe(entregados.length);
    expect(entregados.length).toBeGreaterThan(0);
  });
});
