import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';
import {
  SENALES_AUDITORIA,
  SENALES_CAPTURA,
  type ProveedorDeSenalesDeAuditoria,
  type ProveedorDeSenalesDeCaptura,
  type Ventana,
} from '../../platform/dominio/senales';
import { proponer } from './propuestas';

/**
 * El dominio `aprendizaje` — el sistema mirándose a sí mismo.
 *
 * No toca ninguna tabla de otro dominio: recibe señales ya interpretadas por
 * quien sabe leerlas (Principio III). Lo que aporta es el paso siguiente —
 * convertir esas señales en propuestas concretas que una persona pueda aprobar.
 *
 * **Lo que se construye aquí no pule el sistema hoy.** Un agente no se pule en
 * un día. Lo que se construye es la instrumentación que hace que pulirlo
 * después sea posible y barato — y esa parte no se puede posponer, porque cada
 * conteo que ocurre sin capturar su etiqueta es una lección que se pierde para
 * siempre.
 */
@Injectable()
export class AprendizajeService {
  constructor(
    @Inject(SENALES_CAPTURA) private readonly captura: ProveedorDeSenalesDeCaptura,
    @Inject(SENALES_AUDITORIA) private readonly auditoria: ProveedorDeSenalesDeAuditoria,
  ) {}

  async reporte(v: Ventana) {
    const [captura, auditoria, alias] = await Promise.all([
      this.captura.senalesDeCaptura(v),
      this.auditoria.senalesDeAuditoria(v),
      this.aliasExistentes(),
    ]);

    const propuestas = proponer(captura, alias);

    return {
      ventana: { desde: v.desde, hasta: v.hasta, bodegaId: v.bodegaId ?? null },
      captura: {
        registros: captura.registros,
        correcciones: captura.correcciones,
        tasaDeCorreccion: tasa(captura.correcciones, captura.registros),
        // Cuánto resolvió la gramática sola. Es la métrica que dice si el
        // modelo hace falta: cada punto que sube es dinero que no se gasta y
        // una respuesta que no depende de la red.
        tasaDeGramatica: tasa(captura.porOrigenParse['gramatica'] ?? 0, captura.registros),
        tasaDeDesambiguacionManual: tasa(
          captura.porOrigenNombre['seleccion_usuario'] ?? 0,
          captura.registros,
        ),
        resolucionesDiscrepantes: captura.resolucionesDiscrepantes,
        porOrigenParse: captura.porOrigenParse,
        porOrigenNombre: captura.porOrigenNombre,
      },
      auditoria: {
        reconteos: auditoria.reconteos,
        porRazon: auditoria.porRazon,
        // ⭐ La cifra que importa: de todo lo que el Auditor tuvo que resolver,
        // cuánto fue culpa del sistema y cuánto era una diferencia real.
        erroresDeCaptura: auditoria.erroresDeCaptura,
        diferenciasReales: auditoria.diferenciasReales,
        tasaDeErrorDeCaptura: tasa(auditoria.erroresDeCaptura, auditoria.reconteos),
      },
      propuestas,
      // Lo que el reporte NO dice, y conviene que se lea: ninguna propuesta se
      // aplicó sola. Todas esperan a una persona.
      aplicadas: 0,
    };
  }

  /**
   * Aplica una propuesta de alias. **Con nombre y fecha.**
   *
   * Es un cambio de DATOS, no de reglas: enseña al sistema que cierta forma de
   * decir las cosas apunta a cierto artículo. No mueve ningún umbral, no cambia
   * ningún veredicto pasado y se revierte borrando una fila.
   */
  async aplicarAlias(
    bodegaId: string,
    articuloId: string,
    alias: string,
    usuarioId: string,
  ) {
    const [articulo] = await conexion()<{ id: string; nombre: string }[]>`
      SELECT id, nombre FROM articulo
      WHERE id = ${articuloId} AND bodega_id = ${bodegaId} AND activo`;

    if (!articulo) {
      throw new BadRequestException({
        codigo: 'ARTICULO_NO_ENCONTRADO',
        mensaje: 'El artículo no pertenece a la bodega.',
      });
    }

    const filas = await conexion()<{ id: string }[]>`
      INSERT INTO articulo_alias (id, bodega_id, articulo_id, alias_normalizado, creado_por)
      VALUES (${randomUUID()}, ${bodegaId}, ${articuloId}, ${alias}, ${usuarioId})
      ON CONFLICT (bodega_id, alias_normalizado) DO NOTHING
      RETURNING id`;

    return {
      aplicada: filas.length > 0,
      alias,
      articulo: articulo.nombre,
      // Un alias que ya existía no es un error: es que alguien se adelantó.
      nota: filas.length > 0 ? null : 'El alias ya existía en esta bodega.',
    };
  }

  /** Para no proponer lo que ya está puesto. */
  private async aliasExistentes(): Promise<Set<string>> {
    const filas = await conexion()<{ bodega_id: string; alias_normalizado: string }[]>`
      SELECT bodega_id, alias_normalizado FROM articulo_alias`;
    return new Set(filas.map((f) => `${f.bodega_id}|${f.alias_normalizado}`));
  }
}

/** Porcentaje con un decimal. `null` cuando no hay denominador. */
function tasa(parte: number, total: number): number | null {
  return total === 0 ? null : Math.round((parte / total) * 1000) / 10;
}
