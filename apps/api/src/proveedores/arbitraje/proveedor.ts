/**
 * H4-05 · `ProveedorDeArbitraje` — el árbitro que NO arbitra.
 *
 * El nombre viene del plan y es engañoso a propósito, así que conviene fijar
 * qué hace y qué tiene prohibido antes de mirar el código.
 *
 * **Ordena la evidencia de un caso. No decide quién tiene razón.**
 *
 * La Restricción Técnica 1 prohíbe delegar a un modelo una regla expresable
 * como condición, y "¿cuál de estas dos cifras es la correcta?" no es siquiera
 * eso: es una pregunta que ni el código ni el modelo pueden responder desde un
 * servidor. La responde una persona yendo al estante. Lo que sí puede hacer un
 * modelo —y hace bien— es leer seis registros dispersos y decir en dos frases
 * qué pasó, qué llama la atención y qué conviene verificar primero.
 *
 * La diferencia importa en la práctica: si el sistema dijera "la ronda 2 tiene
 * razón", el Auditor dejaría de ir al estante. Y el día que el modelo se
 * equivocara, nadie lo notaría, porque su cifra ya sería el inventario.
 *
 * Por eso la salida NO tiene campo de veredicto, ni de cantidad sugerida, ni de
 * confianza en una hipótesis. Tiene un relato de lo ocurrido y preguntas.
 */

export interface RegistroDelCaso {
  readonly ronda: string;
  readonly operador: string;
  readonly cuando: string;
  readonly cantidad: string | null;
  readonly estado: string;
  readonly veredicto: string | null;
}

export interface EntradaArbitraje {
  readonly articulo: string;
  readonly unidad: string;
  readonly motivo: string;
  /** ⚠️ Visible SOLO para el Auditor. Nunca vuelve a un Operador (FR-1.18). */
  readonly saldoEsperado: string | null;
  readonly toleranciaAplicada: string | null;
  readonly registros: readonly RegistroDelCaso[];
}

export interface Sintesis {
  /** Qué ocurrió, en orden y sin adjetivos. */
  readonly relato: string;
  /** Lo que salta a la vista. Hechos observables, no conclusiones. */
  readonly observaciones: readonly string[];
  /** Qué conviene verificar primero, en el estante. */
  readonly preguntas: readonly string[];
  /** Códigos de razón que el caso hace plausibles. NO los elige: los sugiere. */
  readonly razonesPlausibles: readonly string[];
}

export interface ResultadoArbitraje {
  readonly sintesis: Sintesis;
  readonly proveedor: string;
}

export interface ProveedorDeArbitraje {
  readonly nombre: string;
  ordenar(entrada: EntradaArbitraje): Promise<ResultadoArbitraje>;
}

export const PROVEEDOR_ARBITRAJE = Symbol('ProveedorDeArbitraje');

/**
 * Los códigos que el catálogo controlado admite hoy (R4).
 *
 * Se le pasan al modelo como lista cerrada. Que sugiera un código inventado
 * sería peor que no sugerir ninguno: el Auditor tendría que descubrir por su
 * cuenta que la opción no existe.
 */
export const RAZONES_CONOCIDAS = [
  'MERMA',
  'ERROR_CONTEO',
  'ERROR_CATALOGO',
  'NO_REGISTRADO',
  'DETERIORO',
  'TRASLADO',
  'SALDO_NEGATIVO',
  'FALTANTE',
  'SOBRANTE',
] as const;
