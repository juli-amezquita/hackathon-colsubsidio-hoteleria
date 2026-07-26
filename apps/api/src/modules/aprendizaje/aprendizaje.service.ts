import { randomUUID } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { conexion } from '../../platform/db/cliente';
import {
  SENALES_AUDITORIA,
  SENALES_CAPTURA,
  type ProveedorDeSenalesDeAuditoria,
  type ProveedorDeSenalesDeCaptura,
  type Ventana,
} from '../../platform/dominio/senales';
import { proponer, type Propuesta } from './propuestas';

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

    // Se PERSISTEN antes de devolverlas: una propuesta que solo existe mientras
    // se mira no se puede aprobar, ni rechazar, ni saber que ya se rechazó.
    const propuestas = await this.registrar(proponer(captura, alias), v.bodegaId ?? null);

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
      // Solo las que esperan decisión. Las rechazadas no vuelven a asomar: un
      // panel que insiste con lo que ya le dijeron que no se deja de leer.
      propuestas: propuestas.filter((p) => p.estado === 'propuesta'),
      // Lo que el reporte NO dice, y conviene que se lea: ninguna propuesta se
      // aplicó sola. Todas esperan a una persona.
      aplicadas: 0,
    };
  }

  /**
   * Guarda las propuestas conservando el estado que ya tuvieran.
   *
   * La huella es la identidad. Al volver a detectar una que ya existe se
   * actualiza su evidencia —creció el número de repeticiones— pero **no su
   * estado**: una rechazada sigue rechazada aunque la evidencia se acumule, y
   * una aplicada no se vuelve a proponer.
   */
  private async registrar(propuestas: readonly Propuesta[], bodegaId: string | null) {
    const guardadas: { estado: string; propuestaId: string; tipo: string; accion: string; evidencia: string; veces: number; aplicable: unknown }[] = [];

    for (const p of propuestas) {
      const [fila] = await conexion()<
        { id: string; estado: string }[]
      >`
        INSERT INTO propuesta_mejora (id, tipo, huella, accion, evidencia, veces, bodega_id, aplicable)
        VALUES (${randomUUID()}, ${p.tipo}, ${p.huella}, ${p.accion}, ${p.evidencia},
                ${p.veces}, ${bodegaId}, ${p.aplicable === null ? null : conexion().json(p.aplicable)})
        ON CONFLICT (huella) DO UPDATE
          SET accion = EXCLUDED.accion,
              evidencia = EXCLUDED.evidencia,
              veces = EXCLUDED.veces,
              vista_en = now()
        RETURNING id, estado`;

      guardadas.push({
        propuestaId: fila!.id,
        estado: fila!.estado,
        tipo: p.tipo,
        accion: p.accion,
        evidencia: p.evidencia,
        veces: p.veces,
        aplicable: p.aplicable,
      });
    }

    return guardadas;
  }

  /** El panel: lo que espera decisión, o lo ya decidido. */
  async listarPropuestas(estado?: string) {
    const filas = await conexion()<
      {
        id: string; tipo: string; accion: string; evidencia: string; veces: number;
        estado: string; aplicable: unknown; detectada_en: Date;
        decidida_en: Date | null; nota: string | null; usuario: string | null;
      }[]
    >`
      SELECT p.id, p.tipo, p.accion, p.evidencia, p.veces, p.estado, p.aplicable,
             p.detectada_en, p.decidida_en, p.nota, u.nombre AS usuario
      FROM propuesta_mejora p
      LEFT JOIN usuario u ON u.id = p.decidida_por
      WHERE ${estado ? conexion()`p.estado = ${estado}::estado_propuesta` : conexion()`true`}
      ORDER BY p.estado, p.veces DESC
      LIMIT 200`;

    return filas.map((f) => ({
      propuestaId: f.id,
      tipo: f.tipo,
      accion: f.accion,
      evidencia: f.evidencia,
      veces: f.veces,
      estado: f.estado,
      // Solo las aplicables se resuelven con un clic. Las demás son trabajo
      // para una persona, y decirlo evita prometer lo que no se cumple.
      seAplicaSola: f.aplicable !== null,
      detectadaEn: f.detectada_en.toISOString(),
      decididaEn: f.decidida_en?.toISOString() ?? null,
      decididaPor: f.usuario,
      nota: f.nota,
    }));
  }

  /**
   * Aprueba una propuesta. Y aquí está la distinción que importa.
   *
   * Un alias es un DATO: aprobarlo lo aplica en el acto y queda `aplicada`.
   * Una mejora de gramática es CÓDIGO: aprobarla la marca `aprobada` y genera
   * trabajo para un desarrollador. Prometer que el sistema se reescribe solo
   * sería prometer justo lo que no debe hacer.
   */
  async decidir(propuestaId: string, aprobar: boolean, usuarioId: string, nota?: string) {
    const [p] = await conexion()<
      { id: string; estado: string; tipo: string; aplicable: { bodegaId: string; articuloId: string; alias: string } | null }[]
    >`SELECT id, estado, tipo, aplicable FROM propuesta_mejora WHERE id = ${propuestaId}`;

    if (!p) {
      throw new NotFoundException({ codigo: 'PROPUESTA_NO_ENCONTRADA', mensaje: 'La propuesta no existe.' });
    }
    if (p.estado !== 'propuesta') {
      throw new BadRequestException({
        codigo: 'PROPUESTA_YA_DECIDIDA',
        mensaje: `Esta propuesta ya está ${p.estado}.`,
      });
    }

    if (!aprobar) {
      await conexion()`
        UPDATE propuesta_mejora
           SET estado = 'rechazada', decidida_por = ${usuarioId}, decidida_en = now(), nota = ${nota ?? null}
         WHERE id = ${propuestaId}`;
      return { propuestaId, estado: 'rechazada', aplicada: false };
    }

    if (p.aplicable === null) {
      await conexion()`
        UPDATE propuesta_mejora
           SET estado = 'aprobada', decidida_por = ${usuarioId}, decidida_en = now(), nota = ${nota ?? null}
         WHERE id = ${propuestaId}`;
      return {
        propuestaId,
        estado: 'aprobada',
        aplicada: false,
        nota: 'Aprobada. Requiere trabajo de desarrollo: no se aplica sola.',
      };
    }

    const r = await this.aplicarAlias(p.aplicable.bodegaId, p.aplicable.articuloId, p.aplicable.alias, usuarioId);

    await conexion()`
      UPDATE propuesta_mejora
         SET estado = 'aplicada', decidida_por = ${usuarioId}, decidida_en = now(),
             aplicada_en = now(), nota = ${nota ?? null}
       WHERE id = ${propuestaId}`;

    return { propuestaId, estado: 'aplicada', aplicada: true, detalle: r };
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
