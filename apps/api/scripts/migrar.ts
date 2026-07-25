import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

import { opcionesSsl } from '../src/platform/db/ssl';

/**
 * Migraciones versionadas y REVERSIBLES (Restricción 6, data-model §4).
 *
 * Ninguna migración se acepta sin su `down` probado: `verificar` aplica todas
 * hacia adelante, revierte hasta cero y vuelve a aplicar. Si una no revierte,
 * no entra — y eso lo comprueba CI, no la buena voluntad de quien la escribió.
 *
 *   pnpm db:migrate    aplica las pendientes
 *   pnpm db:rollback   revierte la última
 *   pnpm db:reset      estado inicial conocido y reproducible
 *   tsx scripts/migrar.ts verificar   ida y vuelta completa (CI)
 */

// En la imagen las migraciones viven en /app/drizzle; en desarrollo, junto al
// código. Explícito por variable en vez de adivinar según dónde quedó el bundle.
const DIR = process.env['DRIZZLE_DIR'] ?? join(__dirname, '..', 'drizzle');
const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

interface Migracion {
  readonly id: string;
  readonly nombre: string;
  readonly up: string;
  readonly down: string;
}

function cargar(): Migracion[] {
  const archivos = readdirSync(DIR).filter((f) => f.endsWith('.up.sql')).sort();

  return archivos.map((archivo) => {
    const nombre = archivo.replace(/\.up\.sql$/, '');
    const id = nombre.split('_')[0] ?? nombre;
    const rutaDown = join(DIR, `${nombre}.down.sql`);

    let down: string;
    try {
      down = readFileSync(rutaDown, 'utf8');
    } catch {
      // Una migración sin `down` rompe la reproducibilidad del entorno.
      throw new Error(`La migración ${nombre} no tiene ${nombre}.down.sql. Toda migración debe revertir.`);
    }

    return { id, nombre, up: readFileSync(join(DIR, archivo), 'utf8'), down };
  });
}

async function tablaDeControl(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migraciones (
      id          text PRIMARY KEY,
      nombre      text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function aplicadas(sql: postgres.Sql): Promise<Set<string>> {
  const filas = await sql<{ id: string }[]>`SELECT id FROM _migraciones`;
  return new Set(filas.map((f) => f.id));
}

async function subir(sql: postgres.Sql): Promise<number> {
  await tablaDeControl(sql);
  const hechas = await aplicadas(sql);
  let n = 0;

  for (const m of cargar()) {
    if (hechas.has(m.id)) continue;
    // Cada migración es atómica: o entra entera o no entra.
    await sql.begin(async (trx) => {
      await trx.unsafe(m.up);
      await trx`INSERT INTO _migraciones (id, nombre) VALUES (${m.id}, ${m.nombre})`;
    });
    console.log(`  ↑ ${m.nombre}`);
    n += 1;
  }

  return n;
}

async function bajar(sql: postgres.Sql, cuantas = 1): Promise<number> {
  await tablaDeControl(sql);
  const hechas = await aplicadas(sql);
  const reversibles = cargar().filter((m) => hechas.has(m.id)).reverse();
  let n = 0;

  for (const m of reversibles.slice(0, cuantas)) {
    await sql.begin(async (trx) => {
      await trx.unsafe(m.down);
      await trx`DELETE FROM _migraciones WHERE id = ${m.id}`;
    });
    console.log(`  ↓ ${m.nombre}`);
    n += 1;
  }

  return n;
}

async function main(): Promise<void> {
  const comando = process.argv[2] ?? 'up';
  const sql = postgres(URL_BD, { max: 1, ssl: opcionesSsl(), onnotice: () => {} });

  try {
    switch (comando) {
      case 'up': {
        const n = await subir(sql);
        console.log(n === 0 ? 'Sin migraciones pendientes.' : `${n} migración(es) aplicada(s).`);
        break;
      }

      case 'down': {
        const n = await bajar(sql);
        console.log(n === 0 ? 'Nada que revertir.' : 'Última migración revertida.');
        break;
      }

      case 'reset': {
        // Estado inicial conocido y reproducible (Restricción 6).
        await bajar(sql, Number.MAX_SAFE_INTEGER);
        await subir(sql);
        console.log('Migraciones al día. Las semillas las aplica `db:reset`.');
        break;
      }

      case 'verificar': {
        // La prueba de que el `down` de cada migración existe y funciona.
        console.log('Ida:');
        await subir(sql);
        console.log('Vuelta hasta cero:');
        await bajar(sql, Number.MAX_SAFE_INTEGER);
        console.log('Ida otra vez:');
        await subir(sql);
        console.log('Ida y vuelta correcta: toda migración revierte.');
        break;
      }

      default:
        throw new Error(`Comando desconocido: ${comando}. Use up | down | reset | verificar.`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
