import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { config } from '../../config';
import { opcionesSsl } from './ssl';

/**
 * Acceso a PostgreSQL (D-13). El modelo es *append-only*: las tablas del libro
 * tienen `UPDATE` y `DELETE` REVOCADOS para el rol de la aplicación (migración 0004).
 * La inmutabilidad no se confía a esta capa: se impone en el motor.
 */

let sql: postgres.Sql | undefined;

export function conexion(): postgres.Sql {
  if (!sql) {
    sql = postgres(config().DATABASE_URL, {
      ssl: opcionesSsl(),
      // PgBouncer va delante en producción; aquí el pool es pequeño a propósito.
      max: 10,
      idle_timeout: 20,
      onnotice: () => {}, // los NOTICE de Postgres no son eventos de la aplicación
    });
  }
  return sql;
}

export function db() {
  return drizzle(conexion());
}

export async function cerrarConexion(): Promise<void> {
  await sql?.end({ timeout: 5 });
  sql = undefined;
}
