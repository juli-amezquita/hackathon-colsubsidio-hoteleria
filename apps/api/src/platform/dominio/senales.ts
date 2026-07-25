/**
 * Señales de aprendizaje — lo que el sistema sabe sobre sí mismo.
 *
 * Casi ningún sistema de IA puede pulirse porque nunca se entera de si acertó.
 * Este sí, y por accidente del diseño: cada vez que una persona **corrige** al
 * sistema, deja una etiqueta.
 *
 *   · Un conteo corregido dice que la lectura estuvo mal Y cuál era la buena
 *     (D4 conserva las dos filas).
 *   · Elegir un candidato de la lista dice cuál debió rankear primero.
 *   · Un fantasma con candidatos descartados dice que la búsqueda falló.
 *   · `resolucion_discrepante` dice que dispositivo y servidor no coincidieron.
 *   · Un reconteo con `ERROR_CONTEO` dice que el problema fue **la captura**;
 *     con `MERMA` o `FALTANTE` dice que la captura estuvo bien y la realidad
 *     difería. Esa distinción es la que evita aprender de ruido.
 *
 * Nada de esto se captura aparte: ya está en el libro. Lo que faltaba era
 * mirarlo.
 *
 * ⚠️ **Estas señales no cambian ninguna regla.** Alimentan propuestas que una
 * persona aprueba. Un sistema que ajusta sus propios umbrales con su propia
 * salida deriva hacia no alertar —las alertas parecen fricción— y acabaría
 * apagando el control mientras todas sus métricas dicen que mejoró.
 */

export interface Ventana {
  readonly desde: string;
  readonly hasta: string;
  readonly bodegaId?: string;
}

/** Un texto dictado que el sistema no supo resolver por sí solo. */
export interface TextoSinResolver {
  readonly texto: string;
  readonly veces: number;
  readonly origenParse: string;
}

/** Un texto que el operario tuvo que desambiguar a mano, y qué eligió. */
export interface DesambiguacionManual {
  readonly texto: string;
  readonly articuloId: string;
  readonly articulo: string;
  readonly bodegaId: string;
  readonly veces: number;
}

/** Una corrección numérica: qué se guardó primero y qué quedó. */
export interface CorreccionNumerica {
  readonly texto: string | null;
  readonly antes: string;
  readonly despues: string;
  readonly articulo: string;
}

export interface SenalesDeCaptura {
  readonly registros: number;
  readonly correcciones: number;
  readonly porOrigenParse: Readonly<Record<string, number>>;
  readonly porOrigenNombre: Readonly<Record<string, number>>;
  readonly resolucionesDiscrepantes: number;
  readonly textosSinResolver: readonly TextoSinResolver[];
  readonly desambiguaciones: readonly DesambiguacionManual[];
  readonly correccionesNumericas: readonly CorreccionNumerica[];
  readonly fantasmasConCandidatosDescartados: number;
}

export interface SenalesDeAuditoria {
  readonly reconteos: number;
  readonly porRazon: Readonly<Record<string, number>>;
  /** Reconteos cuya causa dice que el problema fue la captura. */
  readonly erroresDeCaptura: number;
  /** Reconteos cuya causa dice que la captura estuvo bien. */
  readonly diferenciasReales: number;
}

export interface ProveedorDeSenalesDeCaptura {
  senalesDeCaptura(v: Ventana): Promise<SenalesDeCaptura>;
}

export interface ProveedorDeSenalesDeAuditoria {
  senalesDeAuditoria(v: Ventana): Promise<SenalesDeAuditoria>;
}

export const SENALES_CAPTURA = Symbol('ProveedorDeSenalesDeCaptura');
export const SENALES_AUDITORIA = Symbol('ProveedorDeSenalesDeAuditoria');
