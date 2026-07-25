import { conexion, cerrarConexion } from '../src/platform/db/cliente';
import { ConsolidacionService } from '../src/modules/consolidacion/consolidacion.service';

/**
 * H3-05 · Reconstruye el consolidado entero desde el libro.
 *
 * No es una herramienta de emergencia: es la PRUEBA de que el libro es la
 * fuente de verdad. Si la proyección se pudiera perder y no se pudiera
 * regenerar, entonces contendría información que no está en ningún otro sitio
 * — y habría dejado de ser una proyección para volverse un segundo original.
 *
 * Corre el MISMO método que corre el consumidor del evento. Una ruta de
 * reconstrucción con su propia lógica sería una segunda implementación de la
 * regla, y las dos divergirían justo el día que hiciera falta usarla.
 *
 *   pnpm --filter @cci/api reconstruir            # todas las bodegas
 *   pnpm --filter @cci/api reconstruir <bodega>   # una sola
 */
async function main(): Promise<void> {
  const sql = conexion();
  const objetivo = process.argv[2];

  const bodegas = objetivo
    ? await sql<{ id: string; codigo: string }[]>`SELECT id, codigo FROM bodega WHERE id = ${objetivo} OR codigo = ${objetivo}`
    : await sql<{ id: string; codigo: string }[]>`SELECT id, codigo FROM bodega ORDER BY codigo`;

  if (bodegas.length === 0) {
    console.error(objetivo ? `No existe la bodega ${objetivo}.` : 'No hay bodegas.');
    process.exitCode = 1;
    return;
  }

  const servicio = new ConsolidacionService();
  let total = 0;

  for (const b of bodegas) {
    // Una transacción por bodega: si una falla, las demás quedan reconstruidas.
    const n = await sql.begin((trx) => servicio.reproyectar(trx, b.id));
    total += n as number;
    console.log(`${b.codigo.padEnd(34)} ${String(n).padStart(4)} artículos`);
  }

  const [r] = await sql<{ conciliados: number; auditables: number }[]>`
    SELECT count(*) FILTER (WHERE clasificacion = 'conciliado')::int AS conciliados,
           count(*) FILTER (WHERE clasificacion = 'auditable')::int  AS auditables
    FROM articulo_consolidado`;

  console.log(`\n${total} artículos reproyectados · ${r?.conciliados ?? 0} conciliados · ${r?.auditables ?? 0} auditables`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void cerrarConexion());
