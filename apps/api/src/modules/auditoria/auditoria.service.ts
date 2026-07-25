import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';

import { conexion } from '../../platform/db/cliente';
import { ESCALA_CANTIDAD, aEntero } from '../../platform/numeros/decimal';
import {
  PROVEEDOR_ARBITRAJE,
  type ProveedorDeArbitraje,
  type RegistroDelCaso,
} from '../../proveedores/arbitraje/proveedor';

/**
 * H4-01 a H4-07 · El dominio `auditoria`.
 *
 * Aquí el saldo esperado SÍ se muestra. Es la única superficie del sistema
 * donde eso ocurre, y por eso está aislada en su propio dominio con su propio
 * control de rol: la frontera entre "ver la diferencia" y "no verla" es la que
 * sostiene la ceguera del conteo, así que conviene que sea una frontera de
 * módulo y no un `if` dentro de un servicio compartido.
 */

export interface ReconteoEntrada {
  readonly cantidad: number;
  readonly unidadId: string;
  readonly codigoRazonId: string;
  readonly modoCaptura: 'voz' | 'texto';
  readonly capturadoEn: string;
  readonly claveIdempotencia: string;
}

@Injectable()
export class AuditoriaService {
  constructor(@Inject(PROVEEDOR_ARBITRAJE) private readonly arbitro: ProveedorDeArbitraje) {}

  /**
   * H4-02 · El caso completo de un artículo auditable.
   *
   * ⚠️ Devuelve el saldo esperado y la diferencia. Solo llega al rol Auditor
   * (FR-4.2, FR-4.9); la guarda global lo impone en la ruta.
   */
  async caso(bodegaId: string, articuloId: string, auditorId: string) {
    const [cabecera] = await conexion()<
      {
        nombre: string; codigo: string | null; unidad_id: string; unidad: string;
        clasificacion: string; motivo_auditable: string | null;
        saldo_esperado_congelado: string | null; valor_final: string | null; origen_valor: string | null;
      }[]
    >`
      SELECT a.nombre, a.codigo, u.id AS unidad_id, u.nombre AS unidad,
             c.clasificacion, c.motivo_auditable,
             c.saldo_esperado_congelado, c.valor_final, c.origen_valor
      FROM articulo_consolidado c
      JOIN articulo a      ON a.id = c.articulo_id
      JOIN unidad_medida u ON u.id = a.unidad_esperada_id
      WHERE c.bodega_id = ${bodegaId} AND c.articulo_id = ${articuloId}`;

    if (!cabecera) {
      throw new NotFoundException({ codigo: 'ARTICULO_NO_CONSOLIDADO', mensaje: 'El artículo no está en el consolidado de esta bodega.' });
    }

    const rondas = await conexion()<
      { ronda_id: string; operador: string; operador_id: string; cerrada_en: Date; estado: string; cantidad: string | null; resultado_validacion: string | null; tolerancia_aplicada: string | null }[]
    >`
      SELECT v.ronda_id, u.nombre AS operador, u.id AS operador_id, rc.cerrada_en,
             v.estado, v.cantidad, v.resultado_validacion, v.tolerancia_aplicada
      FROM registro_vigente v
      JOIN ronda r         ON r.id = v.ronda_id
      JOIN ronda_cierre rc ON rc.ronda_id = r.id
      JOIN usuario u       ON u.id = r.operador_id
      WHERE r.bodega_id = ${bodegaId} AND v.articulo_id = ${articuloId}
      ORDER BY rc.cerrada_en`;

    const esperado = cabecera.saldo_esperado_congelado;

    const registros: RegistroDelCaso[] = rondas.map((r) => ({
      ronda: r.ronda_id,
      operador: r.operador,
      cuando: r.cerrada_en.toISOString(),
      cantidad: r.cantidad,
      estado: r.estado,
      veredicto: r.resultado_validacion,
    }));

    const reconteos = await this.reconteosDe(bodegaId, articuloId);

    return {
      articulo: { articuloId, nombre: cabecera.nombre, codigo: cabecera.codigo, unidad: cabecera.unidad, unidadId: cabecera.unidad_id },
      clasificacion: cabecera.clasificacion,
      motivo: cabecera.motivo_auditable,
      // El dato que ningún Operador puede ver, y que el Auditor necesita para
      // decidir si vale la pena subir tres pisos por 200 gramos.
      saldoEsperado: esperado,
      rondas: rondas.map((r) => ({
        rondaId: r.ronda_id,
        operador: r.operador,
        cerradaEn: r.cerrada_en.toISOString(),
        estado: r.estado,
        cantidad: r.cantidad,
        resultadoValidacion: r.resultado_validacion,
        // La diferencia calculada, que es lo que el Auditor realmente lee.
        diferencia: diferencia(r.cantidad, esperado),
        // Señal de independencia: quien audita contó esta ronda (FR-4.7).
        contadaPorEsteAuditor: r.operador_id === auditorId,
      })),
      reconteos,
      valorFinal: cabecera.valor_final,
      origenValor: cabecera.origen_valor,
      // Solo se pide la síntesis si hay algo que sintetizar.
      ...(cabecera.clasificacion === 'auditable'
        ? await this.sintetizar({
            articulo: cabecera.nombre,
            unidad: cabecera.unidad,
            motivo: cabecera.motivo_auditable ?? 'discrepancia',
            saldoEsperado: esperado,
            toleranciaAplicada: rondas.at(-1)?.tolerancia_aplicada ?? null,
            registros,
          })
        : { sintesis: null, arbitro: null }),
    };
  }

  /**
   * Separa la síntesis de quién la produjo.
   *
   * Saber si el caso lo ordenó el modelo o el árbitro determinista importa: no
   * cambia lo que el Auditor debe verificar, pero sí cuánto peso darle al
   * relato. Va en un campo aparte, nunca dentro de la síntesis.
   */
  private async sintetizar(entrada: Parameters<ProveedorDeArbitraje['ordenar']>[0]) {
    const r = await this.arbitro.ordenar(entrada);
    return { sintesis: r.sintesis, arbitro: r.proveedor };
  }

  /**
   * H4-03, H4-04, H4-06 · Registra el reconteo y cierra el caso.
   *
   * El código de razón es obligatorio en la firma, en el contrato y en la
   * columna: coincidir con una de las rondas no exime de explicar por qué
   * había diferencia (edge case de Historia 4, R4).
   */
  async recontar(bodegaId: string, articuloId: string, auditorId: string, entrada: ReconteoEntrada) {
    const [articulo] = await conexion()<{ id: string }[]>`
      SELECT id FROM articulo WHERE id = ${articuloId} AND bodega_id = ${bodegaId} AND activo`;
    if (!articulo) {
      throw new NotFoundException({ codigo: 'ARTICULO_NO_ENCONTRADO', mensaje: 'El artículo no pertenece a la bodega.' });
    }

    const [razon] = await conexion()<{ id: string }[]>`
      SELECT id FROM codigo_razon WHERE id = ${entrada.codigoRazonId} AND activo`;
    if (!razon) {
      throw new BadRequestException({
        codigo: 'RAZON_NO_VALIDA',
        mensaje: 'El código de razón no pertenece al catálogo controlado.',
      });
    }

    return conexion().begin(async (trx) => {
      // FR-4.7 · No se prohíbe auditar una bodega propia: se SEÑALA. Prohibirlo
      // pararía el inventario en un parque donde a veces hay dos personas;
      // registrarlo deja que alguien lo juzgue después, con nombre y fecha.
      const [propia] = await trx<{ n: number }[]>`
        SELECT count(*)::int n FROM ronda r
        JOIN ronda_cierre rc ON rc.ronda_id = r.id
        WHERE r.bodega_id = ${bodegaId} AND r.operador_id = ${auditorId}`;
      const conflicto = (propia?.n ?? 0) > 0;

      const [previo] = await trx<{ maxima: number | null }[]>`
        SELECT max(secuencia) AS maxima FROM reconteo
        WHERE bodega_id = ${bodegaId} AND articulo_id = ${articuloId}
          AND clave_idempotencia <> ${entrada.claveIdempotencia}`;

      // Append-only, igual que el libro de captura: corregirse supersede
      // (FR-4.6). No hay UPDATE en esta tabla y el motor tampoco lo permite.
      const filas = await trx<{ id: string; secuencia: number; recibido_en: Date }[]>`
        INSERT INTO reconteo
          (id, bodega_id, articulo_id, auditor_id, secuencia, cantidad, unidad_id,
           codigo_razon_id, modo_captura, capturado_en, clave_idempotencia,
           conflicto_independencia)
        VALUES (${randomUUID()}, ${bodegaId}, ${articuloId}, ${auditorId},
                ${(previo?.maxima ?? 0) + 1}, ${entrada.cantidad}, ${entrada.unidadId},
                ${entrada.codigoRazonId}, ${entrada.modoCaptura}, ${entrada.capturadoEn},
                ${entrada.claveIdempotencia}, ${conflicto})
        ON CONFLICT (clave_idempotencia) DO NOTHING
        RETURNING id, secuencia, recibido_en`;

      const fila = filas[0] ?? (await trx<{ id: string; secuencia: number; recibido_en: Date }[]>`
        SELECT id, secuencia, recibido_en FROM reconteo
        WHERE clave_idempotencia = ${entrada.claveIdempotencia}`)[0];

      if (!fila) throw new Error('El reconteo no se guardó ni existía previamente.');

      // El caso queda cerrado CON su causa. La restricción `cerrada_exige_razon`
      // hace imposible cerrarlo sin ella aunque este código se equivocara.
      await trx`
        UPDATE discrepancia
           SET estado = 'cerrada', codigo_razon_id = ${entrada.codigoRazonId}, cerrada_en = now()
         WHERE bodega_id = ${bodegaId} AND articulo_id = ${articuloId} AND estado <> 'cerrada'`;

      // El valor del Auditor prevalece sobre el de los Operadores (FR-4.5).
      // Se escribe aquí Y lo recalcula la reproyección desde `reconteo`, así
      // que sobrevive a que alguien reconstruya la bodega entera.
      await trx`
        UPDATE articulo_consolidado
           SET valor_final = ${entrada.cantidad}, unidad_id = ${entrada.unidadId},
               origen_valor = 'auditor', actualizado_en = now()
         WHERE bodega_id = ${bodegaId} AND articulo_id = ${articuloId}`;

      return {
        reconteoId: fila.id,
        secuencia: fila.secuencia,
        recibidoEn: fila.recibido_en.toISOString(),
        conflictoIndependencia: conflicto,
      };
    });
  }

  /** El catálogo controlado. El sistema no lo inventa (R4). */
  async codigosDeRazon() {
    const filas = await conexion()<{ id: string; descripcion: string }[]>`
      SELECT id, descripcion FROM codigo_razon WHERE activo ORDER BY id`;
    return filas;
  }

  /**
   * H4-07 · Ítems auditables sin resolver (FR-4.8).
   *
   * "Sin resolver" es una discrepancia abierta, no una clasificación: un
   * artículo sigue siendo `auditable` para siempre —esa es la conclusión de
   * los conteos y no cambia—, lo que cambia es si alguien ya lo atendió.
   */
  async pendientes(bodegaId: string) {
    const filas = await conexion()<{ articulo_id: string; nombre: string; motivo: string }[]>`
      SELECT d.articulo_id, a.nombre, d.motivo
      FROM discrepancia d
      JOIN articulo a ON a.id = d.articulo_id
      WHERE d.bodega_id = ${bodegaId} AND d.estado <> 'cerrada'
      ORDER BY d.motivo, a.nombre`;

    return filas.map((f) => ({ articuloId: f.articulo_id, nombre: f.nombre, motivo: f.motivo }));
  }

  private async reconteosDe(bodegaId: string, articuloId: string, trx?: postgres.TransactionSql) {
    const sql = trx ?? conexion();
    const filas = await sql<
      { secuencia: number; auditor: string; cantidad: string; codigo_razon_id: string; recibido_en: Date; conflicto_independencia: boolean }[]
    >`
      SELECT r.secuencia, u.nombre AS auditor, r.cantidad, r.codigo_razon_id,
             r.recibido_en, r.conflicto_independencia
      FROM reconteo r JOIN usuario u ON u.id = r.auditor_id
      WHERE r.bodega_id = ${bodegaId} AND r.articulo_id = ${articuloId}
      ORDER BY r.secuencia`;

    return filas.map((f) => ({
      secuencia: f.secuencia,
      auditor: f.auditor,
      cantidad: f.cantidad,
      codigoRazon: f.codigo_razon_id,
      recibidoEn: f.recibido_en.toISOString(),
      conflictoIndependencia: f.conflicto_independencia,
    }));
  }
}

/** La resta que el Auditor lee. `null` cuando falta cualquiera de los dos. */
function diferencia(contado: string | null, esperado: string | null): string | null {
  if (contado === null || esperado === null) return null;
  const d = aEntero(contado, ESCALA_CANTIDAD) - aEntero(esperado, ESCALA_CANTIDAD);
  const signo = d < 0n ? '-' : '';
  const m = (d < 0n ? -d : d).toString().padStart(ESCALA_CANTIDAD + 1, '0');
  return `${signo}${m.slice(0, -ESCALA_CANTIDAD)}.${m.slice(-ESCALA_CANTIDAD)}`;
}
