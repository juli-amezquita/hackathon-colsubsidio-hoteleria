import { BadRequestException, Injectable } from '@nestjs/common';
import type { Evento, TipoEvento } from '@cci/contracts';
import type postgres from 'postgres';

import { conexion } from '../../platform/db/cliente';
import type { Consumidor } from '../../platform/eventos/bus';
import { clasificar, type AfirmacionDeRonda, type Consolidado } from './clasificacion';

/**
 * H3-01, H3-05 · El dominio `consolidacion`.
 *
 * Es un CONSUMIDOR, no un servicio que alguien llama. `captura` cierra una
 * ronda y publica `RondaCerrada` en la misma transacción; este dominio la
 * recoge del outbox y reproyecta. `captura` no sabe que existe (Principio III).
 *
 * Dos propiedades deliberadas:
 *
 *   · **Reproyecta la bodega entera**, no solo la ronda que llegó. Consolidar
 *     es acumular TODAS las rondas cerradas (FR-3.1), y una ronda nueva puede
 *     cambiar la clasificación de artículos que ya estaban clasificados —al
 *     contradecir a otra, por ejemplo—. Reproyectar en incremental exigiría
 *     razonar sobre qué cambió; reproyectar entero no exige razonar nada.
 *
 *   · **Es reconstruible desde cero.** El mismo método que corre en el evento
 *     corre en el comando de reconstrucción. Que la proyección se pueda tirar y
 *     regenerar es lo que demuestra que el libro es la fuente de verdad y no un
 *     archivo paralelo que alguien dejó de mantener.
 */
@Injectable()
export class ConsolidacionService implements Consumidor {
  readonly nombre = 'consolidacion';
  readonly interesadoEn: readonly TipoEvento[] = ['RondaCerrada'];

  async manejar(trx: postgres.TransactionSql, evento: Evento): Promise<void> {
    const { bodegaId } = evento.payload as { bodegaId: string };
    await this.reproyectar(trx, bodegaId);
  }

  /**
   * Recalcula el consolidado completo de una bodega desde el libro.
   *
   * ⚠️ **No toca `registro_conteo` ni `saldo_esperado`** (FR-3.8, D8). Lee y
   * escribe únicamente en su propia proyección. La tabla madre solo se mueve
   * con el aval del Auditor, al cerrar el inventario (FR-7.9).
   */
  async reproyectar(trx: postgres.TransactionSql, bodegaId: string): Promise<number> {
    const filas = await trx<
      {
        articulo_id: string;
        ronda_id: string;
        estado: AfirmacionDeRonda['estado'];
        cantidad: string | null;
        unidad_id: string | null;
        resultado_validacion: string | null;
        saldo_esperado_congelado: string | null;
      }[]
    >`
      SELECT v.articulo_id, v.ronda_id, v.estado, v.cantidad, v.unidad_id,
             v.resultado_validacion, v.saldo_esperado_congelado
      FROM registro_vigente v
      JOIN ronda r        ON r.id = v.ronda_id
      JOIN ronda_cierre rc ON rc.ronda_id = r.id
      WHERE r.bodega_id = ${bodegaId}
      -- Solo rondas CERRADAS. Una ronda abierta todavía puede cambiar, y
      -- consolidar sobre ella sería concluir sobre un conteo a medias.
      ORDER BY v.articulo_id, rc.cerrada_en`;

    // Cada artículo del catálogo entra, haya sido contado o no: los que ninguna
    // ronda afirmó son precisamente los `sin_cobertura`, y omitirlos los
    // volvería invisibles en vez de auditables.
    const articulos = await trx<{ id: string }[]>`
      SELECT id FROM articulo WHERE bodega_id = ${bodegaId} AND activo`;

    // Los reconteos son parte del libro, igual que los registros. Entran en la
    // reproyección para que el valor del Auditor sobreviva a reconstruir la
    // bodega entera (FR-4.5): si solo se escribiera al recontar, la primera
    // ronda que cerrara después lo borraría sin que nadie lo notara.
    const reconteos = await trx<{ articulo_id: string; cantidad: string; unidad_id: string }[]>`
      SELECT articulo_id, cantidad, unidad_id FROM reconteo_vigente
      WHERE bodega_id = ${bodegaId} AND articulo_id IS NOT NULL`;

    const porAuditor = new Map(
      reconteos.map((r) => [r.articulo_id, { cantidad: r.cantidad, unidadId: r.unidad_id }]),
    );

    const porArticulo = new Map<string, AfirmacionDeRonda[]>();
    for (const f of filas) {
      const lista = porArticulo.get(f.articulo_id) ?? [];
      lista.push({
        rondaId: f.ronda_id,
        estado: f.estado,
        cantidad: f.cantidad,
        unidadId: f.unidad_id,
        resultadoValidacion: f.resultado_validacion,
        saldoEsperadoCongelado: f.saldo_esperado_congelado,
      });
      porArticulo.set(f.articulo_id, lista);
    }

    for (const { id } of articulos) {
      await this.guardar(trx, bodegaId, id, clasificar(porArticulo.get(id) ?? [], porAuditor.get(id)));
    }

    await this.escalarFantasmas(trx, bodegaId);

    return articulos.length;
  }

  /**
   * H5-03 · Todo hallazgo sin catálogo va al Auditor. Siempre (FR-5.3).
   *
   * No hay clasificación que calcular: un producto que no está en el catálogo
   * no tiene saldo esperado, no tiene contra qué compararse y no existe regla
   * automática que pueda darlo por bueno. Por eso ni siquiera pasa por
   * `clasificar`: va directo a la bandeja.
   *
   * **Una discrepancia por hallazgo, sin fusionar** (FR-5.5). Dos rondas que
   * describen "caja de galletas surtidas" pueden estar viendo dos cajas o la
   * misma, y decidirlo mirando texto es precisamente lo que el sistema no debe
   * hacer por su cuenta. El índice único sobre `fantasma_id` lo garantiza.
   */
  private async escalarFantasmas(trx: postgres.TransactionSql, bodegaId: string): Promise<void> {
    await trx`
      INSERT INTO discrepancia (id, bodega_id, fantasma_id, motivo)
      SELECT gen_random_uuid(), ${bodegaId}, pf.id, 'producto_fantasma'
      FROM producto_fantasma pf
      JOIN ronda_cierre rc ON rc.ronda_id = pf.ronda_id
      WHERE pf.bodega_id = ${bodegaId}
      ON CONFLICT (fantasma_id) WHERE fantasma_id IS NOT NULL DO NOTHING`;
  }

  private async guardar(
    trx: postgres.TransactionSql,
    bodegaId: string,
    articuloId: string,
    c: Consolidado,
  ): Promise<void> {
    await trx`
      INSERT INTO articulo_consolidado
        (bodega_id, articulo_id, clasificacion, motivo_auditable,
         valor_final, unidad_id, origen_valor,
         rondas_afirmando, saldo_esperado_congelado, actualizado_en)
      VALUES (${bodegaId}, ${articuloId}, ${c.clasificacion}, ${c.motivo},
              ${c.valorFinal}, ${c.unidadId}, ${c.origenValor},
              ${c.rondasAfirmando}, ${c.saldoEsperadoCongelado}, now())
      ON CONFLICT (bodega_id, articulo_id) DO UPDATE SET
        clasificacion            = EXCLUDED.clasificacion,
        motivo_auditable         = EXCLUDED.motivo_auditable,
        valor_final              = EXCLUDED.valor_final,
        unidad_id                = EXCLUDED.unidad_id,
        origen_valor             = EXCLUDED.origen_valor,
        rondas_afirmando         = EXCLUDED.rondas_afirmando,
        saldo_esperado_congelado = EXCLUDED.saldo_esperado_congelado,
        actualizado_en           = now()`;

    // La discrepancia es la unidad de trabajo del Auditor (Slice 4). Se abre
    // una por artículo auditable y solo si no existe ya ninguna.
    //
    // Que la condición sea "ninguna" y no "ninguna abierta" es deliberado: un
    // caso que el Auditor cerró con su causa NO se reabre solo porque la
    // bodega se reproyecte. Reabrirlo desharía su decisión sin que nadie la
    // revocara, y su cifra prevalece de todos modos (FR-4.5).
    if (c.clasificacion === 'auditable' && c.motivo) {
      await trx`
        INSERT INTO discrepancia (id, bodega_id, articulo_id, motivo)
        SELECT gen_random_uuid(), ${bodegaId}, ${articuloId}, ${c.motivo}
        WHERE NOT EXISTS (
          SELECT 1 FROM discrepancia
          WHERE bodega_id = ${bodegaId} AND articulo_id = ${articuloId})`;
    }
  }

  /**
   * La bandeja: exclusivamente lo auditable (FR-4.1).
   *
   * Un artículo sigue siendo `auditable` incluso después de que el Auditor lo
   * resuelva: esa es la conclusión de los conteos y no cambia con el tiempo.
   * Lo que cambia es si alguien ya lo atendió, y eso viaja en `resuelto`.
   */
  async auditables(bodegaId: string) {
    const filas = await conexion()<
      { articulo_id: string; nombre: string; codigo: string | null; motivo_auditable: string; rondas_afirmando: number; resuelto: boolean }[]
    >`
      SELECT c.articulo_id, a.nombre, a.codigo, c.motivo_auditable, c.rondas_afirmando,
             NOT EXISTS (
               SELECT 1 FROM discrepancia d
               WHERE d.bodega_id = c.bodega_id AND d.articulo_id = c.articulo_id
                 AND d.estado <> 'cerrada'
             ) AS resuelto
      FROM articulo_consolidado c
      JOIN articulo a ON a.id = c.articulo_id
      WHERE c.bodega_id = ${bodegaId} AND c.clasificacion = 'auditable'
      ORDER BY c.motivo_auditable, a.nombre`;

    return filas.map((f) => ({
      articuloId: f.articulo_id,
      nombre: f.nombre,
      codigo: f.codigo,
      motivo: f.motivo_auditable,
      rondasAfirmando: f.rondas_afirmando,
      resuelto: f.resuelto,
    }));
  }

  /** Resumen de la bodega. Es lo que hace demostrable el slice. */
  async resumen(bodegaId: string) {
    const [r] = await conexion()<
      { conciliados: number; auditables: number; rondas_cerradas: number; total: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE clasificacion = 'conciliado')::int AS conciliados,
        count(*) FILTER (WHERE clasificacion = 'auditable')::int  AS auditables,
        (SELECT count(*)::int FROM ronda r
          JOIN ronda_cierre rc ON rc.ronda_id = r.id
          WHERE r.bodega_id = ${bodegaId})                        AS rondas_cerradas,
        count(*)::int                                             AS total
      FROM articulo_consolidado WHERE bodega_id = ${bodegaId}`;

    const porMotivo = await conexion()<{ motivo_auditable: string; n: number }[]>`
      SELECT motivo_auditable, count(*)::int n FROM articulo_consolidado
      WHERE bodega_id = ${bodegaId} AND clasificacion = 'auditable'
      GROUP BY motivo_auditable ORDER BY 2 DESC`;

    return {
      conciliados: r?.conciliados ?? 0,
      auditables: r?.auditables ?? 0,
      rondasCerradas: r?.rondas_cerradas ?? 0,
      total: r?.total ?? 0,
      porMotivo: Object.fromEntries(porMotivo.map((m) => [m.motivo_auditable, m.n])),
    };
  }

  /**
   * H3-01 · Qué registró cada ronda y quién la ejecutó (FR-3.1).
   *
   * Sale del libro, no de la proyección. Copiarlo al consolidado sería crear
   * una segunda versión de un dato que ya existe y que además es inmutable:
   * las dos divergirían el día que alguien tocara solo una.
   */
  async detallePorRonda(bodegaId: string, articuloId: string) {
    const filas = await conexion()<
      { ronda_id: string; operador: string; cerrada_en: Date; estado: string; cantidad: string | null; resultado_validacion: string | null }[]
    >`
      SELECT v.ronda_id, u.nombre AS operador, rc.cerrada_en,
             v.estado, v.cantidad, v.resultado_validacion
      FROM registro_vigente v
      JOIN ronda r         ON r.id = v.ronda_id
      JOIN ronda_cierre rc ON rc.ronda_id = r.id
      JOIN usuario u       ON u.id = r.operador_id
      WHERE r.bodega_id = ${bodegaId} AND v.articulo_id = ${articuloId}
      ORDER BY rc.cerrada_en`;

    return filas.map((f) => ({
      rondaId: f.ronda_id,
      operador: f.operador,
      cerradaEn: f.cerrada_en.toISOString(),
      estado: f.estado,
      cantidad: f.cantidad,
      resultadoValidacion: f.resultado_validacion,
    }));
  }

  /**
   * H3-06 · No se cierra un inventario sin al menos una ronda cerrada (FR-3.7).
   *
   * Cerrar sin ninguna ronda publicaría al ERP una bodega entera clasificada
   * `sin_cobertura`, es decir: un inventario donde nadie contó nada, avalado.
   */
  async verificarCierrePosible(bodegaId: string): Promise<void> {
    const [r] = await conexion()<{ n: number }[]>`
      SELECT count(*)::int n FROM ronda r
      JOIN ronda_cierre rc ON rc.ronda_id = r.id
      WHERE r.bodega_id = ${bodegaId}`;

    if ((r?.n ?? 0) === 0) {
      throw new BadRequestException({
        codigo: 'SIN_RONDAS_CERRADAS',
        mensaje: 'No se puede cerrar el inventario de una bodega sin al menos una ronda cerrada.',
      });
    }

    // H4-07, FR-4.8 · Y tampoco con ítems auditables sin resolver. Cerrar con
    // pendientes publicaría al ERP artículos que el propio sistema marcó como
    // dudosos, avalados por nadie.
    const [pendientes] = await conexion()<{ n: number }[]>`
      SELECT count(*)::int n FROM discrepancia
      WHERE bodega_id = ${bodegaId} AND estado <> 'cerrada'`;

    if ((pendientes?.n ?? 0) > 0) {
      throw new BadRequestException({
        codigo: 'AUDITABLES_PENDIENTES',
        mensaje: `Quedan ${pendientes!.n} ítems auditables sin resolver.`,
        detalles: { pendientes: pendientes!.n },
      });
    }
  }
}
