import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';
import {
  PROVEEDOR_ESTADO,
  PROVEEDOR_PENDIENTES,
  PROVEEDOR_SALIDAS,
  type ProveedorDeEstado,
  type ProveedorDePendientes,
  type ProveedorDeSalidas,
} from '../../platform/dominio/estado';
import { PREGUNTAS_DE_EJEMPLO, resolver } from './preguntas';

/**
 * H9-01, H9-02 · El dominio `consulta` — el supervisor preguntando.
 *
 * Solo lectura, y no por convención: este servicio **no tiene ningún método que
 * escriba** salvo el contador de minutos. Los tres proveedores que inyecta son
 * interfaces de lectura, y ninguna operación de escritura del sistema está a su
 * alcance aunque alguien la llamara.
 */

/**
 * Tope mensual de conversación por supervisor.
 *
 * El agente de voz cuesta por minuto (~$0,05 según el brief, **sin verificar**).
 * D-10 fija la señal de escalado en 400 min/mes; el tope va en ese número.
 *
 * Que exista un tope y no solo una alerta es deliberado: una alerta que llega
 * al correo de alguien no detiene el gasto, y el modo consulta es una comodidad
 * —no una función crítica—. Que se apague solo es la respuesta correcta.
 */
const TOPE_MINUTOS_MES = 400;

/** A partir de aquí se avisa, antes de que el tope sorprenda a nadie. */
const AVISO_EN = 0.8;

@Injectable()
export class ConsultaService {
  constructor(
    @Inject(PROVEEDOR_ESTADO) private readonly estado: ProveedorDeEstado,
    @Inject(PROVEEDOR_PENDIENTES) private readonly pendientes: ProveedorDePendientes,
    @Inject(PROVEEDOR_SALIDAS) private readonly salidas: ProveedorDeSalidas,
  ) {}

  /**
   * Responde una pregunta. **En texto, sin ningún proveedor externo.**
   *
   * Esta es la vía principal, no un respaldo: el agente de voz solo añade la
   * conversación. Si x.ai no existe mañana, el supervisor sigue preguntando —
   * escribiendo— y obteniendo exactamente las mismas respuestas (Restricción 5).
   */
  async responder(bodegaId: string, pregunta: string) {
    const { intencion, entendido } = resolver(pregunta);

    switch (intencion) {
      case 'estado': {
        const e = await this.estado.estadoDeBodega(bodegaId);
        const motivos = Object.entries(e.porMotivo)
          .map(([m, n]) => `${n} por ${m.replace(/_/g, ' ')}`)
          .join(', ');

        return {
          entendido,
          respuesta:
            e.total === 0
              ? 'Esta bodega todavía no tiene consolidado: no se ha cerrado ninguna ronda.'
              : `De ${e.total} artículos, ${e.conciliados} quedaron conciliados y ${e.auditables} necesitan al Auditor` +
                `${motivos ? ` (${motivos})` : ''}. Se han cerrado ${e.rondasCerradas} rondas.`,
          datos: e,
        };
      }

      case 'pendientes': {
        const items = await this.pendientes.pendientesDeBodega(bodegaId);
        const porMotivo = new Map<string, number>();
        for (const i of items) porMotivo.set(i.motivo, (porMotivo.get(i.motivo) ?? 0) + 1);

        return {
          entendido,
          respuesta:
            items.length === 0
              ? 'No queda nada por resolver en esta bodega.'
              : `Quedan ${items.length} ítems por resolver: ` +
                [...porMotivo].map(([m, n]) => `${n} por ${m.replace(/_/g, ' ')}`).join(', ') +
                `. Los primeros son ${items.slice(0, 3).map((i) => i.nombre).join(', ')}.`,
          datos: { total: items.length, items: items.slice(0, 20) },
        };
      }

      case 'salidas': {
        const items = await this.salidas.salidasDeBodega(bodegaId);
        const alErp = items.filter((i) => i.destino === 'erp');

        return {
          entendido,
          respuesta:
            items.length === 0
              ? 'De esta bodega no ha salido nada todavía: ni descargas ni envíos.'
              : `Hubo ${items.length} salidas${alErp.length > 0 ? `, ${alErp.length} al sistema central` : ', ninguna al sistema central'}.` +
                ` La última la hizo ${items[0]!.usuario} con ${items[0]!.enviadas} artículos.`,
          datos: { total: items.length, items: items.slice(0, 20) },
        };
      }

      default:
        return {
          entendido,
          respuesta:
            'Puedo responder sobre el estado del inventario, lo que falta por resolver ' +
            'y lo que ya salió al sistema central. No puedo modificar nada.',
          datos: { ejemplos: PREGUNTAS_DE_EJEMPLO },
        };
    }
  }

  /**
   * H9-02 · Comprueba el cupo y lo reserva.
   *
   * Se cuenta una sesión ANTES de emitir la credencial, no después: si se
   * contara al cerrar, una sesión que el navegador abandona sin avisar sería
   * gratis, y el tope dejaría de serlo justo en el caso que hay que acotar.
   */
  async reservarMinutos(usuarioId: string, minutosEstimados: number) {
    const periodo = new Date().toISOString().slice(0, 7); // AAAA-MM

    const [previo] = await conexion()<{ segundos: number; sesiones: number }[]>`
      SELECT segundos, sesiones FROM consumo_voz
      WHERE usuario_id = ${usuarioId} AND periodo = ${periodo}`;

    const usados = (previo?.segundos ?? 0) / 60;

    if (usados + minutosEstimados > TOPE_MINUTOS_MES) {
      throw new BadRequestException({
        codigo: 'CUPO_DE_VOZ_AGOTADO',
        mensaje:
          `El cupo de consulta por voz de este mes se agotó (${TOPE_MINUTOS_MES} minutos). ` +
          'La consulta por texto sigue disponible y responde lo mismo.',
        detalles: { usados: Math.round(usados), tope: TOPE_MINUTOS_MES, periodo },
      });
    }

    await conexion()`
      INSERT INTO consumo_voz (usuario_id, periodo, segundos, sesiones)
      VALUES (${usuarioId}, ${periodo}, ${Math.round(minutosEstimados * 60)}, 1)
      ON CONFLICT (usuario_id, periodo) DO UPDATE
        SET segundos = consumo_voz.segundos + EXCLUDED.segundos,
            sesiones = consumo_voz.sesiones + 1`;

    const total = usados + minutosEstimados;

    return {
      periodo,
      minutosUsados: Math.round(total),
      minutosRestantes: Math.max(0, Math.round(TOPE_MINUTOS_MES - total)),
      tope: TOPE_MINUTOS_MES,
      // El aviso llega antes de que el tope sorprenda a nadie a mitad de mes.
      aviso:
        total >= TOPE_MINUTOS_MES * AVISO_EN
          ? `Va por el ${Math.round((total / TOPE_MINUTOS_MES) * 100)}% del cupo mensual.`
          : null,
    };
  }

  /** El consumo del periodo, para que el Administrador lo vea sin esperar. */
  async consumo(periodo?: string) {
    const mes = periodo ?? new Date().toISOString().slice(0, 7);

    const filas = await conexion()<{ usuario: string; segundos: number; sesiones: number }[]>`
      SELECT u.nombre AS usuario, c.segundos, c.sesiones
      FROM consumo_voz c JOIN usuario u ON u.id = c.usuario_id
      WHERE c.periodo = ${mes} ORDER BY c.segundos DESC`;

    return {
      periodo: mes,
      tope: TOPE_MINUTOS_MES,
      porUsuario: filas.map((f) => ({
        usuario: f.usuario,
        minutos: Math.round(f.segundos / 60),
        sesiones: f.sesiones,
      })),
    };
  }
}
