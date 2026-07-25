import { SetMetadata } from '@nestjs/common';
import type { Rol } from '@cci/contracts';

/**
 * F-15 · Autorización NEGADA POR DEFECTO.
 *
 * Sin uno de estos decoradores, una ruta no es accesible para nadie. El error
 * seguro es el olvido: quien añade un endpoint y no piensa en permisos obtiene
 * un 403, no una fuga. Al revés —abierto por defecto— el olvido es una brecha
 * que nadie nota hasta que alguien la encuentra.
 */

export const CLAVE_ROLES = 'cci:roles';
export const CLAVE_PUBLICO = 'cci:publico';

/** Solo estos roles. El cliente recibe su rol para pintar, jamás para permitir. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/** Explícitamente sin autenticación: login y sonda de salud. Nada más. */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);
