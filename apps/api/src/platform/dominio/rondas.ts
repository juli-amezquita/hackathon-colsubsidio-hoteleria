/**
 * Interfaz PUBLICADA del dominio `captura` (Principio III).
 *
 * Existe por un solo consumidor —la emisión de la credencial de voz, que
 * necesita saber a qué bodega pertenece la ronda para mandar su vocabulario—
 * y por eso su superficie es de un método.
 *
 * Fíjate en que lleva el operador: resolver la bodega de una ronda ajena
 * filtraría qué bodegas existen y quién las está contando. La comprobación de
 * pertenencia va DENTRO, no en quien llama.
 */
export interface ProveedorDeRondas {
  /** La bodega de una ronda propia y abierta. Falla si no lo es. */
  bodegaDeRondaPropia(rondaId: string, operadorId: string): Promise<string>;
}

export const PROVEEDOR_RONDAS = Symbol('ProveedorDeRondas');
