import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { opcionesSsl } from '../src/platform/db/ssl';
import { desfaseReloj, insertarIdempotente } from '../src/platform/idempotencia/idempotencia';

/**
 * F-19/F-20 · Reintentos seguros y doble sello de tiempo.
 *
 * Se prueba contra la base real y contra la tabla real del libro, no contra una
 * de laboratorio: la garantía la da una restricción UNIQUE de Postgres, así que
 * probarla en otro sitio no probaría nada.
 */
const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

describe('F-19 · idempotencia', () => {
  let sql: postgres.Sql;
  let rondaId: string;
  let articuloId: string;
  let unidadId: string;

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 4, ssl: opcionesSsl(), onnotice: () => {} });

    const [b] = await sql<{ id: string }[]>`SELECT id FROM bodega LIMIT 1`;
    const [u] = await sql<{ id: string }[]>`SELECT id FROM usuario WHERE rol_id='operador' LIMIT 1`;
    const [a] = await sql<{ id: string; unidad_esperada_id: string }[]>`
      SELECT id, unidad_esperada_id FROM articulo WHERE bodega_id = ${b!.id} LIMIT 1`;

    articuloId = a!.id;
    unidadId = a!.unidad_esperada_id;
    rondaId = randomUUID();

    await sql`INSERT INTO ronda (id, bodega_id, operador_id, desfase_reloj_ms)
              VALUES (${rondaId}, ${b!.id}, ${u!.id}, 0)`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** Un envío del dispositivo. Se puede llamar N veces con la misma clave. */
  const enviar = (clave: string, secuencia: number, cantidad: number) =>
    sql.begin((trx) =>
      insertarIdempotente(trx, {
        tabla: 'registro_conteo',
        clave,
        insertar: async (t) => {
          const f = await t<{ id: string }[]>`
            INSERT INTO registro_conteo
              (id, ronda_id, articulo_id, secuencia, estado, cantidad, unidad_id,
               modo_captura, origen_parse, capturado_en, clave_idempotencia)
            VALUES (${randomUUID()}, ${rondaId}, ${articuloId}, ${secuencia}, 'contado',
                    ${cantidad}, ${unidadId}, 'voz', 'gramatica', now(), ${clave})
            ON CONFLICT (clave_idempotencia) DO NOTHING
            RETURNING id`;
          return f[0]?.id;
        },
        recuperar: async (t) => {
          const f = await t<{ id: string }[]>`
            SELECT id FROM registro_conteo WHERE clave_idempotencia = ${clave}`;
          return f[0]?.id;
        },
      }),
    );

  it('el mismo envío repetido guarda UNA vez y devuelve lo mismo', async () => {
    const clave = randomUUID();

    const primero = await enviar(clave, 1, 20);
    const segundo = await enviar(clave, 1, 20);
    const tercero = await enviar(clave, 1, 20);

    expect(primero.creado).toBe(true);
    expect(segundo.creado).toBe(false);
    expect(tercero.creado).toBe(false);

    // El reintento ve EXACTAMENTE la misma respuesta que el envío original.
    // Si viera un error, el cliente reintentaría para siempre.
    expect(segundo.valor).toBe(primero.valor);
    expect(tercero.valor).toBe(primero.valor);

    const [f] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM registro_conteo WHERE clave_idempotencia = ${clave}`;
    expect(f?.n).toBe(1);
  });

  it('diez reintentos SIMULTÁNEOS siguen guardando una sola vez', async () => {
    // Lo que pasa de verdad cuando vuelve la red y la cola se vacía de golpe.
    const clave = randomUUID();
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => enviar(clave, 2, 15).catch(() => null)),
    );

    const creados = resultados.filter((r) => r?.creado).length;
    expect(creados).toBe(1);

    const [f] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM registro_conteo WHERE clave_idempotencia = ${clave}`;
    expect(f?.n).toBe(1);
  });

  it('claves distintas sí producen registros distintos: no deduplica de más', async () => {
    const a = await enviar(randomUUID(), 3, 5);
    const b = await enviar(randomUUID(), 4, 5);

    expect(a.creado).toBe(true);
    expect(b.creado).toBe(true);
    expect(a.valor).not.toBe(b.valor);
  });
});

describe('F-20 · doble sello de tiempo', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL_BD, { max: 1, ssl: opcionesSsl(), onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('guarda el momento del cliente y el del servidor por separado', async () => {
    const [f] = await sql<{ capturado_en: Date; recibido_en: Date }[]>`
      SELECT capturado_en, recibido_en FROM registro_conteo ORDER BY recibido_en DESC LIMIT 1`;

    // Dos columnas, no una: el orden dentro de la ronda es del cliente —correcto
    // aunque no haya red— y la autoridad legal es del servidor.
    expect(f?.capturado_en).toBeInstanceOf(Date);
    expect(f?.recibido_en).toBeInstanceOf(Date);
  });

  it('el desfase se mide con signo: adelantado y atrasado son distintos', () => {
    expect(desfaseReloj(1_000_500, 1_000_000)).toBe(500); // dispositivo adelantado
    expect(desfaseReloj(999_500, 1_000_000)).toBe(-500); // atrasado
    expect(desfaseReloj(1_000_000, 1_000_000)).toBe(0);
  });
});
