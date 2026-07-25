import { createHash, randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';
import { PUERTO_ERP, type LineaInventario, type PuertoInventarioERP } from '../../proveedores/erp/puerto';

/**
 * H7-01 a H7-06 · El dominio `integracion`.
 *
 * Es el destino del dato y el punto donde se elimina la transcripción manual,
 * que era el origen del problema entero. Sin esto el sistema mejora el conteo
 * pero deja intacta la causa raíz.
 *
 * **Todo se calcula aquí, en el servidor** (Principio I). Un CSV armado en el
 * dispositivo sería un segundo lugar donde vive la regla de qué es el valor
 * final, y el día que las dos divergieran nadie sabría cuál se envió al ERP.
 */

export interface FilaConsolidada {
  readonly codigo: string | null;
  readonly nombre: string;
  readonly unidad: string;
  readonly clasificacion: string;
  readonly motivo: string | null;
  readonly saldoSistema: string | null;
  readonly valorFinal: string | null;
  readonly origenValor: string | null;
  readonly codigoRazon: string | null;
  readonly rondasAfirmando: number;
}

@Injectable()
export class IntegracionService {
  constructor(@Inject(PUERTO_ERP) private readonly erp: PuertoInventarioERP) {}

  /**
   * H7-02 · El consolidado, con todo lo que hace falta para responder por él.
   *
   * Cada fila dice el valor final, de dónde salió y con qué causa se cerró
   * (FR-7.7). Un consolidado sin origen sería una lista de números sin nadie
   * detrás — justo lo que este sistema existe para reemplazar.
   */
  async consolidado(bodegaId: string): Promise<FilaConsolidada[]> {
    const filas = await conexion()<
      {
        codigo: string | null; nombre: string; unidad: string;
        clasificacion: string; motivo_auditable: string | null;
        saldo_esperado_congelado: string | null; valor_final: string | null;
        origen_valor: string | null; codigo_razon_id: string | null; rondas_afirmando: number;
      }[]
    >`
      SELECT a.codigo, a.nombre, u.nombre AS unidad,
             c.clasificacion, c.motivo_auditable,
             c.saldo_esperado_congelado, c.valor_final, c.origen_valor,
             d.codigo_razon_id, c.rondas_afirmando
      FROM articulo_consolidado c
      JOIN articulo a      ON a.id = c.articulo_id
      JOIN unidad_medida u ON u.id = COALESCE(c.unidad_id, a.unidad_esperada_id)
      LEFT JOIN discrepancia d
             ON d.bodega_id = c.bodega_id AND d.articulo_id = c.articulo_id
            AND d.estado = 'cerrada'
      WHERE c.bodega_id = ${bodegaId}
      ORDER BY a.nombre`;

    return filas.map((f) => ({
      // FR-7.1 · El nombre siempre; el código cuando exista. En el archivo real
      // del cliente hay artículos sin código, y omitirlos del reporte por eso
      // sería perder justo los que nadie tiene fichados.
      codigo: f.codigo,
      nombre: f.nombre,
      unidad: f.unidad,
      clasificacion: f.clasificacion,
      motivo: f.motivo_auditable,
      saldoSistema: f.saldo_esperado_congelado,
      valorFinal: f.valor_final,
      origenValor: f.origen_valor,
      codigoRazon: f.codigo_razon_id,
      rondasAfirmando: f.rondas_afirmando,
    }));
  }

  /**
   * H7-06, FR-7.6, FR-7.9 · La puerta que todo lo definitivo tiene que cruzar.
   *
   * El aval del Auditor es la condición para que un conteo de Operador llegue
   * al sistema central. No es una formalidad: sin ella, un número que nadie
   * verificó se convertiría en el inventario de la compañía (D8).
   */
  async exigirInventarioAvalado(bodegaId: string): Promise<void> {
    const [rondas] = await conexion()<{ n: number }[]>`
      SELECT count(*)::int n FROM ronda r
      JOIN ronda_cierre rc ON rc.ronda_id = r.id
      WHERE r.bodega_id = ${bodegaId}`;

    if ((rondas?.n ?? 0) === 0) {
      throw new BadRequestException({
        codigo: 'SIN_RONDAS_CERRADAS',
        mensaje: 'La bodega no tiene ninguna ronda cerrada.',
      });
    }

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

  /**
   * Cierra el inventario de la bodega: el aval (FR-7.9, D8).
   *
   * Aquí y solo aquí se mueve la tabla madre. Hasta este momento cada conteo
   * vivió en un registro hijo que congelaba el número del sistema junto al
   * contado; ahora el sistema adopta el resultado. Es el punto exacto donde el
   * inventario deja de ser una observación y pasa a ser el dato de la empresa.
   */
  async cerrarInventario(bodegaId: string, usuarioId: string) {
    await this.exigirInventarioAvalado(bodegaId);

    const filas = await this.consolidado(bodegaId);

    return conexion().begin(async (trx) => {
      const [yaCerrado] = await trx<{ cerrado_en: Date }[]>`
        SELECT cerrado_en FROM cierre_inventario WHERE bodega_id = ${bodegaId}`;
      if (yaCerrado) {
        throw new BadRequestException({
          codigo: 'INVENTARIO_YA_CERRADO',
          mensaje: `El inventario de esta bodega se cerró el ${yaCerrado.cerrado_en.toISOString()}.`,
        });
      }

      // Huella de lo que se avaló. Permite demostrar después que lo enviado al
      // ERP es exactamente lo que alguien firmó, y no una versión posterior.
      const hash = huella(filas);

      await trx`
        INSERT INTO cierre_inventario (bodega_id, cerrado_por, hash_consolidado)
        VALUES (${bodegaId}, ${usuarioId}, ${hash})`;

      // ⚠️ LA TABLA MADRE SE MUEVE AQUÍ. En ningún otro punto del sistema.
      //
      // Solo los artículos con valor final: lo auditable sin resolver no llega
      // hasta aquí —la puerta de arriba lo impide— y lo que nadie afirmó no
      // tiene por qué pisar el saldo que el ERP ya tenía.
      const actualizados = await trx<{ articulo_id: string }[]>`
        UPDATE saldo_esperado s
           SET cantidad = c.valor_final
          FROM articulo_consolidado c
         WHERE c.bodega_id = s.bodega_id AND c.articulo_id = s.articulo_id
           AND c.bodega_id = ${bodegaId} AND c.valor_final IS NOT NULL
        RETURNING s.articulo_id`;

      return {
        bodegaId,
        cerradoEn: new Date().toISOString(),
        hashConsolidado: hash,
        articulos: filas.length,
        saldosActualizados: actualizados.length,
      };
    });
  }

  /**
   * H7-03 a H7-05 · Envía el consolidado al sistema central.
   *
   * La referencia se deriva del contenido, no de la hora: dos envíos de lo
   * mismo llevan la misma referencia y el segundo no duplica movimientos
   * (FR-7.4). Si el contenido cambia, la referencia cambia — y debe cambiar,
   * porque ya no es el mismo envío.
   */
  async enviarAlErp(bodegaId: string, usuarioId: string) {
    await this.exigirInventarioAvalado(bodegaId);

    const [cerrado] = await conexion()<{ hash_consolidado: string }[]>`
      SELECT hash_consolidado FROM cierre_inventario WHERE bodega_id = ${bodegaId}`;
    if (!cerrado) {
      throw new BadRequestException({
        codigo: 'INVENTARIO_NO_CERRADO',
        mensaje: 'El inventario debe cerrarse con el aval del Auditor antes de enviarlo (FR-7.9).',
      });
    }

    const [bodega] = await conexion()<{ codigo: string }[]>`
      SELECT codigo FROM bodega WHERE id = ${bodegaId}`;
    if (!bodega) throw new NotFoundException({ codigo: 'BODEGA_NO_ENCONTRADA', mensaje: 'Bodega no disponible.' });

    const filas = await this.consolidado(bodegaId);
    const lineas: LineaInventario[] = filas
      .filter((f) => f.valorFinal !== null)
      .map((f) => ({
        articuloId: f.codigo ?? f.nombre,
        codigo: f.codigo,
        nombre: f.nombre,
        cantidad: f.valorFinal!,
        unidad: f.unidad,
        origen: f.origenValor ?? 'conteo_ciego',
        codigoRazon: f.codigoRazon,
      }));

    const referencia = `cci:${bodegaId}:${cerrado.hash_consolidado.slice(0, 16)}`;

    // Un reenvío del MISMO consolidado devuelve la constancia original. La
    // clave UNIQUE de la tabla lo garantiza aunque dos peticiones lleguen a la
    // vez: la segunda choca y lee lo que la primera guardó.
    const [previa] = await conexion()<
      { id: string; estado: string; articulos_aceptados: number; ejecutado_en: Date }[]
    >`
      SELECT id, estado, articulos_aceptados, ejecutado_en
      FROM constancia_salida WHERE referencia = ${referencia} AND estado <> 'fallido'`;

    if (previa) {
      return {
        constanciaId: previa.id,
        referencia,
        estado: previa.estado,
        enviadas: lineas.length,
        aceptadas: previa.articulos_aceptados,
        reenvio: true,
        proveedor: this.erp.nombre,
      };
    }

    const resultado = await this.erp.enviar({ referencia, bodegaCodigo: bodega.codigo, lineas });

    const id = randomUUID();
    await conexion()`
      INSERT INTO constancia_salida
        (id, bodega_id, destino, estado, referencia, ejecutado_por,
         articulos_enviados, articulos_aceptados, respuesta_erp)
      VALUES (${id}, ${bodegaId}, 'erp', ${resultado.estado}, ${referencia}, ${usuarioId},
              ${lineas.length}, ${resultado.aceptadas}, ${conexion().json(resultado.respuestaCruda as never)})
      ON CONFLICT (referencia) DO NOTHING`;

    return {
      constanciaId: id,
      referencia,
      estado: resultado.estado,
      enviadas: lineas.length,
      aceptadas: resultado.aceptadas,
      rechazos: resultado.rechazos,
      reenvio: false,
      proveedor: this.erp.nombre,
    };
  }

  /** H7-05 · Deja constancia de una descarga. Quién, qué y cuándo (FR-7.5). */
  async registrarDescarga(bodegaId: string, usuarioId: string, formato: 'csv' | 'xlsx', filas: number) {
    await conexion()`
      INSERT INTO constancia_salida
        (id, bodega_id, destino, estado, referencia, ejecutado_por, articulos_enviados, articulos_aceptados)
      VALUES (${randomUUID()}, ${bodegaId}, ${formato}, 'aceptado',
              ${`${formato}:${bodegaId}:${randomUUID()}`}, ${usuarioId}, ${filas}, ${filas})`;
  }

  /** La traza de salidas de una bodega. Es lo que se audita después (SC-7.3). */
  async constancias(bodegaId: string) {
    const filas = await conexion()<
      { id: string; destino: string; estado: string; referencia: string; usuario: string; ejecutado_en: Date; articulos_enviados: number; articulos_aceptados: number }[]
    >`
      SELECT cs.id, cs.destino, cs.estado, cs.referencia, u.nombre AS usuario,
             cs.ejecutado_en, cs.articulos_enviados, cs.articulos_aceptados
      FROM constancia_salida cs
      JOIN usuario u ON u.id = cs.ejecutado_por
      WHERE cs.bodega_id = ${bodegaId}
      ORDER BY cs.ejecutado_en DESC`;

    return filas.map((f) => ({
      constanciaId: f.id,
      destino: f.destino,
      estado: f.estado,
      referencia: f.referencia,
      usuario: f.usuario,
      ejecutadoEn: f.ejecutado_en.toISOString(),
      enviadas: f.articulos_enviados,
      aceptadas: f.articulos_aceptados,
    }));
  }
}

/**
 * Huella del consolidado avalado.
 *
 * Se calcula sobre los campos que importan contablemente —artículo, cantidad,
 * origen y causa—, no sobre el objeto entero: incluir un timestamp haría que
 * dos huellas del mismo inventario difirieran, y la referencia de envío dejaría
 * de ser estable justo cuando hace falta que lo sea.
 */
function huella(filas: readonly FilaConsolidada[]): string {
  const canonico = filas
    .map((f) => [f.codigo ?? '', f.nombre, f.valorFinal ?? '', f.origenValor ?? '', f.codigoRazon ?? ''].join('|'))
    .sort()
    .join('\n');

  return createHash('sha256').update(canonico).digest('hex');
}
