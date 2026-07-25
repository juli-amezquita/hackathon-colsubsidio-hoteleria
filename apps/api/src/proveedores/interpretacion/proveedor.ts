import type { UnidadCanonica } from '@cci/gramatica';

/**
 * F-28 · `ProveedorDeInterpretacion` — el ~10% que la gramática no resuelve.
 *
 * Tres cosas que este contrato deja fijas por diseño:
 *
 * 1. **Solo interpreta entrada ambigua. NUNCA juzga validez.** La Restricción
 *    Técnica 1 prohíbe delegar a un modelo una regla expresable como
 *    condición, y "¿esta cantidad es válida?" lo es.
 * 2. **Devuelve candidatos, no decisiones.** Si el modelo no está seguro, el
 *    sistema pregunta (FR-1.11).
 * 3. **Su salida vuelve a la validación determinista** antes de guardarse
 *    (F-29). El modelo propone; el código dispone.
 */

export interface EntradaInterpretacion {
  /** El texto crudo del turno, tal como salió de la transcripción. */
  readonly textoDictado: string;
  /** Nombres del catálogo de la bodega. Es el bloque estático cacheado (D-17). */
  readonly catalogo: readonly string[];
  readonly bodegaId: string;
}

export interface PropuestaInterpretacion {
  /** Nombre TAL COMO APARECE en el catálogo, o null si no se reconoció. */
  readonly nombre: string | null;
  readonly cantidad: number | null;
  readonly unidad: UnidadCanonica | null;
  /** 0 a 1. Por debajo del umbral se pregunta en vez de guardar. */
  readonly confianza: number;
  /** Por qué dudó. Va a la traza, no al Operador. */
  readonly nota: string | null;
}

export interface ResultadoInterpretacion {
  readonly propuesta: PropuestaInterpretacion;
  /** Diagnóstico de caché: si `leidosDeCache` es 0 hay un invalidador silencioso. */
  readonly uso: {
    readonly entrada: number;
    readonly salida: number;
    readonly escritosACache: number;
    readonly leidosDeCache: number;
  };
}

export interface ProveedorDeInterpretacion {
  readonly nombre: string;
  interpretar(entrada: EntradaInterpretacion): Promise<ResultadoInterpretacion>;
}

export const PROVEEDOR_INTERPRETACION = Symbol('ProveedorDeInterpretacion');

/** Por debajo de esto, el sistema pregunta en vez de guardar (FR-1.27). */
export const UMBRAL_CONFIANZA = 0.8;
