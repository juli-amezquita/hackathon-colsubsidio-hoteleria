import { readFileSync } from 'node:fs';

/**
 * TLS hacia PostgreSQL.
 *
 * RDS rechaza conexiones en claro (`rds.force_ssl`), y el Principio V exige que
 * todo dato de inventario viaje cifrado. Pero cifrar sin verificar el
 * certificado deja la puerta abierta a un intermediario: la mitad del trabajo.
 *
 * Por eso la imagen trae el bundle de CA de RDS y aquí se verifica de verdad.
 * Si el archivo no está —desarrollo local contra el Postgres de docker— se
 * conecta sin TLS, que es lo correcto en un contenedor local.
 */
export function opcionesSsl(): { ca: string; rejectUnauthorized: true } | false {
  const ruta = process.env['RDS_CA_PATH'];
  if (!ruta) return false;

  try {
    return { ca: readFileSync(ruta, 'utf8'), rejectUnauthorized: true };
  } catch {
    // Fallar ruidosamente: si alguien definió RDS_CA_PATH esperaba TLS
    // verificado, y degradar en silencio sería darle una garantía que no tiene.
    throw new Error(`RDS_CA_PATH apunta a ${ruta}, que no se puede leer.`);
  }
}
