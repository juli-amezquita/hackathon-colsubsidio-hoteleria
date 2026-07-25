import { Injectable } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';
import type {
  ProveedorDeSenalesDeAuditoria,
  SenalesDeAuditoria,
  Ventana,
} from '../../platform/dominio/senales';

/**
 * Las señales que produce el dominio `auditoria`.
 *
 * Aquí está la etiqueta más valiosa del sistema y es gratis: **el código de
 * razón separa el error de captura de la diferencia real.**
 *
 * Sin esa distinción, cualquier intento de pulir la percepción estaría
 * aprendiendo de ruido: un artículo que no cuadra porque de verdad falta
 * mercancía no dice nada sobre si el micrófono entendió bien. `ERROR_CONTEO`
 * sí lo dice, y lo dice una persona que fue al estante a comprobarlo.
 */

/** Causas que significan "la captura estuvo mal". */
const ERROR_DE_CAPTURA = new Set(['ERROR_CONTEO', 'ERROR_CATALOGO']);

@Injectable()
export class SenalesAuditoriaService implements ProveedorDeSenalesDeAuditoria {
  async senalesDeAuditoria(v: Ventana): Promise<SenalesDeAuditoria> {
    const bodega = v.bodegaId ?? null;

    const filas = await conexion()<{ codigo_razon_id: string; n: number }[]>`
      SELECT codigo_razon_id, count(*)::int n
      FROM reconteo
      WHERE recibido_en >= ${v.desde} AND recibido_en < ${v.hasta}
        AND (${bodega}::uuid IS NULL OR bodega_id = ${bodega})
      GROUP BY 1 ORDER BY 2 DESC`;

    const total = filas.reduce((n, f) => n + f.n, 0);
    const captura = filas
      .filter((f) => ERROR_DE_CAPTURA.has(f.codigo_razon_id))
      .reduce((n, f) => n + f.n, 0);

    return {
      reconteos: total,
      porRazon: Object.fromEntries(filas.map((f) => [f.codigo_razon_id, f.n])),
      erroresDeCaptura: captura,
      diferenciasReales: total - captura,
    };
  }
}
