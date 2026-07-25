import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { opcionesSsl } from '../src/platform/db/ssl';

/**
 * E7 · La inmutabilidad del libro (D2, FR-1.13, migración 0004).
 *
 * Es la prueba que sostiene la garantía central del sistema: un conteo, una vez
 * registrado, no se puede alterar ni borrar. La comprobación se hace CONTRA EL
 * MOTOR, asumiendo el rol real de la aplicación — no contra la capa de código,
 * que es justamente lo que no queremos tener que confiar.
 *
 * Si estas pruebas se caen, D2 dejó de estar garantizada.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

/** Tablas del libro: solo inserción. */
const LIBRO = [
  'ronda',
  'ronda_cierre',
  'registro_conteo',
  'producto_fantasma',
  'evidencia_audio',
  'reconteo',
  'cierre_inventario',
] as const;

describe('E7 · el libro es de solo inserción', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 1, ssl: opcionesSsl(), onnotice: () => {} });
    await sql`select 1`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /**
   * La columna se descubre del catálogo en vez de codificarse: así, añadir una
   * tabla a LIBRO no obliga a saberse sus columnas, y el test no se cae por un
   * detalle que no es el que está probando.
   */
  async function primeraColumna(tabla: string): Promise<string> {
    const [col] = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${tabla} AND table_schema = 'public'
      ORDER BY ordinal_position LIMIT 1`;
    if (!col) throw new Error(`La tabla ${tabla} no existe: la migración no se aplicó.`);
    return col.column_name;
  }

  for (const tabla of LIBRO) {
    it(`rechaza UPDATE sobre ${tabla}`, async () => {
      const col = await primeraColumna(tabla);
      await expect(
        sql.begin(async (t) => {
          await t`SET LOCAL ROLE app_role`;
          await t.unsafe(`UPDATE ${tabla} SET ${col} = ${col}`);
        }),
      ).rejects.toThrow(/permission denied/i);
    });

    it(`rechaza DELETE sobre ${tabla}`, async () => {
      await expect(
        sql.begin(async (t) => {
          await t`SET LOCAL ROLE app_role`;
          await t.unsafe(`DELETE FROM ${tabla}`);
        }),
      ).rejects.toThrow(/permission denied/i);
    });
  }

  it('sí permite leer el catálogo: la restricción es sobre el libro, no sobre todo', async () => {
    const filas = await sql.begin(async (t) => {
      await t`SET LOCAL ROLE app_role`;
      return t<{ n: number }[]>`SELECT count(*)::int AS n FROM articulo`;
    });

    expect(filas[0]?.n).toBeGreaterThan(0);
  });

  it('la vista del vigente existe y es legible', async () => {
    await expect(
      sql.begin(async (t) => {
        await t`SET LOCAL ROLE app_role`;
        return t`SELECT * FROM registro_vigente LIMIT 1`;
      }),
    ).resolves.toBeDefined();
  });
});

describe('D5 · la base impide conciliar sin conteo afirmado', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL_BD, { max: 1, ssl: opcionesSsl(), onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('rechaza un conciliado que ninguna ronda afirmó', async () => {
    // El caso que la restricción existe para impedir: publicar al ERP una cifra
    // que nadie contó, por un error de código en la consolidación.
    await expect(
      sql.begin(async (t) => {
        const [b] = await t<{ id: string }[]>`SELECT id FROM bodega LIMIT 1`;
        const [a] = await t<{ id: string }[]>`SELECT id FROM articulo LIMIT 1`;
        await t`INSERT INTO articulo_consolidado
                  (bodega_id, articulo_id, clasificacion, rondas_afirmando)
                VALUES (${b!.id}, ${a!.id}, 'conciliado', 0)`;
      }),
    ).rejects.toThrow(/conciliado_exige_conteo_afirmado/i);
  });

  it('rechaza un auditable sin motivo', async () => {
    await expect(
      sql.begin(async (t) => {
        const [b] = await t<{ id: string }[]>`SELECT id FROM bodega LIMIT 1`;
        const [a] = await t<{ id: string }[]>`SELECT id FROM articulo OFFSET 1 LIMIT 1`;
        await t`INSERT INTO articulo_consolidado
                  (bodega_id, articulo_id, clasificacion, rondas_afirmando)
                VALUES (${b!.id}, ${a!.id}, 'auditable', 1)`;
      }),
    ).rejects.toThrow(/auditable_exige_motivo/i);
  });
});

describe('D-19 · resolución del nombre por similitud', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL_BD, { max: 1, ssl: opcionesSsl(), onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('resuelve un nombre dictado con error de transcripción', async () => {
    // Lo que llegaría de un STT en una bodega con ruido: el operario dijo
    // "aceite de oliva" y la transcripción perdió una letra.
    const filas = await sql<{ nombre: string; puntaje: number }[]>`
      SELECT nombre, similarity(nombre_normalizado, 'aceite de olva') AS puntaje
      FROM articulo
      WHERE nombre_normalizado % 'aceite de olva'
      ORDER BY puntaje DESC
      LIMIT 3`;

    expect(filas[0]?.nombre).toBe('ACEITE DE OLIVA');
  });

  it('devuelve VARIOS candidatos cuando el nombre es ambiguo', async () => {
    // El catálogo real tiene ACEITE, ACEITE DE OLIVA, ACEITE DE AJONJOLI y
    // ACEITE DE OLIVA 10ML /BOLS. Decir "aceite" no alcanza para elegir, y el
    // sistema NO debe elegir: debe preguntar (FR-1.11, FR-1.27).
    const filas = await sql<{ nombre: string }[]>`
      SELECT DISTINCT nombre FROM articulo
      WHERE nombre_normalizado % 'aceite'
      ORDER BY nombre`;

    expect(filas.length).toBeGreaterThan(1);
  });

  it('los saldos negativos del sistema central se cargan tal cual', async () => {
    // 79 artículos llegan del ERP con saldo negativo. No se corrigen ni se
    // descartan al importar: son la anomalía que el inventario debe encontrar.
    const [f] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM saldo_esperado WHERE cantidad < 0`;

    expect(f?.n).toBeGreaterThan(0);
  });
});
