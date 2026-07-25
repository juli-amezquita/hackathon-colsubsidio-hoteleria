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

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 4, ssl: opcionesSsl(), onnotice: () => {} });
    bus = new OutboxBus();
    const [b] = await sql<{ id: string }[]>`SELECT id FROM bodega LIMIT 1`;
    const [a] = await sql<{ id: string }[]>`SELECT id FROM articulo LIMIT 1`;
    bodegaId = b!.id;
    articuloId = a!.id;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`DELETE FROM evento_procesado`;
    await sql`DELETE FROM outbox`;
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

    const [f] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM outbox`;
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
      SELECT count(*)::int n FROM outbox WHERE despachado_en IS NULL`;
    expect(f?.n).toBe(1); // sigue pendiente: se reintentará

    // Y la marca de procesado tampoco quedó: iba en la misma transacción.
    const [p] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM evento_procesado`;
    expect(p?.n).toBe(0);
  });

  it('entregado dos veces, el efecto ocurre UNA sola vez', async () => {
    await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));

    let efectos = 0;
    const contador: Consumidor = {
      nombre: 'consumidor-contador',
      interesadoEn: ['ConteoRegistrado'],
      manejar: () => {
        efectos += 1;
        return Promise.resolve();
      },
    };

    const d = new DespachadorOutbox(sql, [contador]);
    expect(await d.pasada()).toBe(1);
    expect(efectos).toBe(1);

    // Se fuerza la reentrega, como si el despachador hubiera muerto justo
    // después de aplicar el efecto pero antes de marcar el evento.
    await sql`UPDATE outbox SET despachado_en = NULL`;
    expect(await d.pasada()).toBe(1);

    expect(efectos).toBe(1); // el efecto NO se repitió
  });

  it('solo entrega a los consumidores interesados en ese tipo', async () => {
    await sql.begin((trx) => bus.publicar(trx, eventoDePrueba(bodegaId, articuloId)));

    const recibidos: string[] = [];
    const mk = (nombre: string, tipos: Evento['tipo'][]): Consumidor => ({
      nombre,
      interesadoEn: tipos,
      manejar: () => {
        recibidos.push(nombre);
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

    let efectos = 0;
    const c = (nombre: string): Consumidor => ({
      nombre,
      interesadoEn: ['ConteoRegistrado'],
      manejar: () => {
        efectos += 1;
        return Promise.resolve();
      },
    });

    const [a, b] = await Promise.all([
      new DespachadorOutbox(sql, [c('compartido')]).pasada(),
      new DespachadorOutbox(sql, [c('compartido')]).pasada(),
    ]);

    expect(a + b).toBe(5);
    expect(efectos).toBe(5);
  });
});
