import { Inject, Injectable } from '@nestjs/common';
import { normalizar } from '@cci/gramatica';
import type { ArticuloDeTrabajo, ResolucionArticulo } from '@cci/contracts';

import { Cache, CLAVES } from '../../platform/cache/cache';
import { conexion } from '../../platform/db/cliente';
import type { ProveedorDeCatalogo } from '../../platform/dominio/catalogo';

/**
 * H1-02 · Resolución del nombre dictado (D-19).
 *
 * Con captura libre esta es la RUTA CALIENTE: se ejecuta en cada turno, no
 * solo en fantasmas y búsqueda manual. Por eso `pg_trgm` con índice GIN y no
 * un modelo — buscar en un catálogo cerrado es búsqueda, no generación, y la
 * Restricción 1 prohíbe delegar a un modelo lo que es una condición.
 */

/** Similitud mínima para considerar siquiera un candidato. */
const UMBRAL_ACEPTACION = 0.45;

/**
 * Distancia mínima entre el primero y el segundo.
 *
 * Este es el umbral que de verdad importa. El catálogo real tiene `ACEITE`,
 * `ACEITE DE OLIVA`, `ACEITE DE AJONJOLI` y `ACEITE DE OLIVA 10ML /BOLS` en la
 * misma bodega: sin margen, "aceite" resolvería al azar entre cuatro. Con
 * margen, el sistema **pregunta** (FR-1.27).
 */
const UMBRAL_MARGEN = 0.15;

const MAX_CANDIDATOS = 5;

interface FilaCandidata {
  readonly id: string;
  readonly nombre: string;
  readonly codigo: string | null;
  readonly unidad_id: string;
  readonly unidad_nombre: string;
  readonly es_peso: boolean;
  readonly puntaje: number;
  readonly via_alias: boolean;
}

@Injectable()
export class ResolucionService implements ProveedorDeCatalogo {
  // Token explícito: esbuild no emite `design:paramtypes`, así que la inyección
  // por tipo funciona compilada con tsc y falla bajo vitest. Ver identidad.controller.ts.
  constructor(@Inject(Cache) private readonly cache: Cache) {}

  async resolver(bodegaId: string, textoDictado: string): Promise<ResolucionArticulo> {
    const objetivo = normalizar(textoDictado);
    if (!objetivo) {
      return { estado: 'sin_coincidencia', articulo: null, origenNombre: null, candidatos: [] };
    }

    const filas = await this.buscarCandidatos(bodegaId, objetivo);
    if (filas.length === 0) {
      return { estado: 'sin_coincidencia', articulo: null, origenNombre: null, candidatos: [] };
    }

    const mejor = filas[0]!;
    const segundo = filas[1];

    // Coincidencia exacta: no hay nada que desambiguar aunque haya vecinos
    // parecidos. "ACEITE" dicho tal cual ES el artículo "ACEITE".
    const exacta = normalizar(mejor.nombre) === objetivo;

    const superaAceptacion = mejor.puntaje >= UMBRAL_ACEPTACION;
    const margenSuficiente = !segundo || mejor.puntaje - segundo.puntaje >= UMBRAL_MARGEN;

    if (exacta || (superaAceptacion && margenSuficiente)) {
      return {
        estado: 'resuelto',
        articulo: this.aArticulo(mejor),
        origenNombre: exacta ? 'exacto' : mejor.via_alias ? 'alias' : 'similitud',
        candidatos: [],
      };
    }

    // Ni resuelto ni descartado: decide la persona. El sistema NO elige.
    return {
      estado: 'candidatos',
      articulo: null,
      origenNombre: null,
      candidatos: filas.map((f) => ({ articulo: this.aArticulo(f), puntaje: f.puntaje })),
    };
  }

  /**
   * Busca por nombre y por alias en una sola pasada, quedándose con el mejor
   * puntaje de cada artículo.
   *
   * El alias existe porque la gente no llama a las cosas como las llama el
   * ERP. Cuando la desambiguación manual sube, la mejora barata es poblar esta
   * tabla, no tocar el algoritmo.
   */
  private buscarCandidatos(bodegaId: string, objetivo: string): Promise<FilaCandidata[]> {
    return conexion()<FilaCandidata[]>`
      WITH puntuado AS (
        SELECT a.id, a.nombre, a.codigo,
               u.id AS unidad_id, u.nombre AS unidad_nombre, u.es_peso,
               similarity(a.nombre_normalizado, ${objetivo}) AS puntaje,
               false AS via_alias
        FROM articulo a
        JOIN unidad_medida u ON u.id = a.unidad_esperada_id
        WHERE a.bodega_id = ${bodegaId} AND a.activo
          AND a.nombre_normalizado % ${objetivo}

        UNION ALL

        SELECT a.id, a.nombre, a.codigo,
               u.id AS unidad_id, u.nombre AS unidad_nombre, u.es_peso,
               similarity(al.alias_normalizado, ${objetivo}) AS puntaje,
               true AS via_alias
        FROM articulo_alias al
        JOIN articulo a ON a.id = al.articulo_id
        JOIN unidad_medida u ON u.id = a.unidad_esperada_id
        WHERE al.bodega_id = ${bodegaId} AND a.activo
          AND al.alias_normalizado % ${objetivo}
      )
      SELECT DISTINCT ON (id) id, nombre, codigo, unidad_id, unidad_nombre, es_peso,
             puntaje, via_alias
      FROM puntuado
      ORDER BY id, puntaje DESC
      LIMIT 50`.then((filas) =>
      [...filas].sort((a, b) => b.puntaje - a.puntaje).slice(0, MAX_CANDIDATOS),
    );
  }

  /**
   * Catálogo de la bodega, cacheado. **Sin saldos, sin tolerancias.**
   *
   * Es exactamente lo que el dispositivo descarga y guarda para resolver
   * nombres sin red (F-21b). Que este método no pueda devolver un saldo es lo
   * que hace seguro cachearlo en el cliente.
   */
  listar(bodegaId: string): Promise<ArticuloDeTrabajo[]> {
    return this.cache.obtener(CLAVES.catalogo(bodegaId), async () => {
      const filas = await conexion()<
        { id: string; nombre: string; codigo: string | null; unidad_id: string; unidad_nombre: string; es_peso: boolean }[]
      >`
        SELECT a.id, a.nombre, a.codigo, u.id AS unidad_id, u.nombre AS unidad_nombre, u.es_peso
        FROM articulo a
        JOIN unidad_medida u ON u.id = a.unidad_esperada_id
        WHERE a.bodega_id = ${bodegaId} AND a.activo
        ORDER BY a.nombre`;

      return filas.map((f) => this.aArticulo(f as unknown as FilaCandidata));
    });
  }

  async buscar(bodegaId: string, articuloId: string): Promise<ArticuloDeTrabajo | null> {
    const filas = await conexion()<FilaCandidata[]>`
      SELECT a.id, a.nombre, a.codigo, u.id AS unidad_id, u.nombre AS unidad_nombre,
             u.es_peso, 1::real AS puntaje, false AS via_alias
      FROM articulo a
      JOIN unidad_medida u ON u.id = a.unidad_esperada_id
      WHERE a.id = ${articuloId} AND a.bodega_id = ${bodegaId} AND a.activo
      LIMIT 1`;

    const f = filas[0];
    return f ? this.aArticulo(f) : null;
  }

  /** ⚠️ Uso interno del servidor. Su resultado NUNCA sale en una respuesta. */
  async contextoDeValidacion(
    bodegaId: string,
    articuloId: string,
  ): Promise<{ saldoEsperado: number | null; toleranciaMerma: number | null; esPeso: boolean }> {
    const filas = await conexion()<
      { cantidad: string | null; porcentaje: string | null; es_peso: boolean }[]
    >`
      SELECT s.cantidad, cm.porcentaje, u.es_peso
      FROM articulo a
      JOIN unidad_medida u ON u.id = a.unidad_esperada_id
      LEFT JOIN saldo_esperado s ON s.articulo_id = a.id AND s.bodega_id = ${bodegaId}
      LEFT JOIN configuracion_merma cm ON cm.unidad_id = u.id
      WHERE a.id = ${articuloId} AND a.bodega_id = ${bodegaId}
      LIMIT 1`;

    const f = filas[0];
    if (!f) return { saldoEsperado: null, toleranciaMerma: null, esPeso: false };

    return {
      saldoEsperado: f.cantidad === null ? null : Number(f.cantidad),
      // La merma solo aplica a unidades de peso (FR-2.3). `Liter` queda fuera
      // hasta que el negocio lo confirme — no se asume.
      toleranciaMerma: f.es_peso && f.porcentaje !== null ? Number(f.porcentaje) : null,
      esPeso: f.es_peso,
    };
  }

  private aArticulo(f: FilaCandidata): ArticuloDeTrabajo {
    return {
      articuloId: f.id,
      nombre: f.nombre,
      codigo: f.codigo,
      unidadEsperada: { id: f.unidad_id, nombre: f.unidad_nombre, esPeso: f.es_peso },
    };
  }
}
