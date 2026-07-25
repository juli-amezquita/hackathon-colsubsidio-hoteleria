import type { Rol } from '@cci/contracts';

/**
 * Interfaz PUBLICADA del dominio `identidad` (Principio III).
 *
 * Vive en `platform/dominio` y no dentro del módulo a propósito: es lo que otros
 * dominios pueden consumir. Todo lo demás de `identidad` —tablas, hashing,
 * firma de cookie— les está vedado, y la regla de lint lo verifica.
 */
export interface UsuarioAutenticado {
  readonly usuarioId: string;
  readonly nombre: string;
  readonly rol: Rol;
}

/**
 * D3 · Identidad propia, sustituible por el directorio institucional.
 *
 * El MVP autentica contra un padrón propio. Que esté detrás de esta interfaz es
 * lo que permite cambiarlo por el directorio de Colsubsidio sin rehacer el resto
 * del sistema — y lo que evita que la fecha en que nos den ese acceso bloquee
 * todo lo demás.
 */
export interface ProveedorDeIdentidad {
  /** Devuelve null si las credenciales no son válidas. Nunca dice cuál falló. */
  autenticar(usuario: string, password: string): Promise<UsuarioAutenticado | null>;
  buscarPorId(usuarioId: string): Promise<UsuarioAutenticado | null>;
  bodegasDe(usuarioId: string): Promise<{ id: string; nombre: string }[]>;
}

export const PROVEEDOR_IDENTIDAD = Symbol('ProveedorDeIdentidad');
