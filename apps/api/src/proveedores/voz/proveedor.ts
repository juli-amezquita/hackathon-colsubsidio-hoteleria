/**
 * F-23 · `ProveedorDeVoz` detrás de una interfaz (Restricción 5).
 *
 * Con D-07 cerrada en la opción A, el backend **nunca ve el audio**: el
 * navegador habla directo con el proveedor de transcripción usando una
 * credencial efímera que emitimos nosotros. Por eso esta interfaz no
 * transcribe — solo acredita.
 *
 * Que exista la interfaz es lo que permite conmutar a Flux self-hosteado, a
 * otro STT, o a la opción B —audio por nuestro servidor— sin tocar los
 * dominios. Y lo que hace que el adaptador simulado sea de primera clase en
 * vez de un parche de pruebas.
 */

export interface CredencialDeVoz {
  /** Token de un solo uso. NUNCA es nuestra credencial de cuenta. */
  readonly token: string;
  readonly expiraEn: string;
  readonly proveedor: 'deepgram' | 'simulado';
  /** Dónde debe conectarse el dispositivo. */
  readonly endpoint: string;
  /** Parámetros del modelo: idioma, formateo de numerales, fin de turno. */
  readonly opciones: Readonly<Record<string, string | number | boolean>>;
}

export interface ProveedorDeVoz {
  readonly nombre: string;
  /**
   * Emite una credencial acotada al usuario y a la ronda.
   *
   * Corta en el tiempo y en el alcance a propósito: si se filtra, el daño
   * está limitado a una sesión de conteo, no a la cuenta.
   */
  emitirCredencial(contexto: { usuarioId: string; rondaId: string }): Promise<CredencialDeVoz>;
}

export const PROVEEDOR_VOZ = Symbol('ProveedorDeVoz');

/**
 * Opciones del modelo, iguales para todos los adaptadores.
 *
 * `numerals` es la que más importa: devuelve `19.8` en vez de "diecinueve
 * punto ocho". Sin eso habría que escribir un normalizador de números en
 * español en el dispositivo — que es justo el código que más se rompe.
 * La gramática lo sigue soportando de todos modos (Restricción 5).
 */
export const OPCIONES_MODELO = {
  language: 'es',
  numerals: true,
  smart_format: true,
  /** Fin de turno del propio modelo, no un umbral de silencio nuestro. */
  eot_threshold: 0.7,
} as const;
