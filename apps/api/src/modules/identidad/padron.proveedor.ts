import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { RolSchema } from '@cci/contracts';

import { conexion } from '../../platform/db/cliente';
import type { ProveedorDeIdentidad, UsuarioAutenticado } from '../../platform/dominio/identidad';

/**
 * F-13 · Autenticación contra el padrón propio, con argon2id (Principio V).
 *
 * argon2id, no bcrypt ni un hash de propósito general: es lo que la Constitución
 * exige y lo que resiste ataque con GPU.
 */

/**
 * Hash de descarte con el mismo costo que uno real. Se verifica contra él
 * cuando el usuario no existe, para que el tiempo de respuesta sea el mismo
 * exista o no — si no, medir la latencia permite enumerar usuarios (OWASP A07).
 */
const SEÑUELO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2VudGluZWxhZGVjb3N0bw$HkVYFPvcCq0GNMCXBqBLnvhPBAPCbT7g0zLHhZaFxKs';

@Injectable()
export class PadronPropio implements ProveedorDeIdentidad {
  async autenticar(usuario: string, password: string): Promise<UsuarioAutenticado | null> {
    const filas = await conexion()<
      { id: string; nombre: string; rol_id: string; hash_password: string; activo: boolean }[]
    >`
      SELECT id, nombre, rol_id, hash_password, activo
      FROM usuario
      WHERE documento = ${usuario}
      LIMIT 1`;

    const u = filas[0];

    if (!u) {
      await verify(SEÑUELO, password).catch(() => false);
      return null;
    }

    const correcta = await verify(u.hash_password, password).catch(() => false);
    // Un usuario inactivo se rechaza IGUAL que uno con clave equivocada: decir
    // "tu cuenta está desactivada" ya confirma que la cuenta existe.
    if (!correcta || !u.activo) return null;

    return { usuarioId: u.id, nombre: u.nombre, rol: RolSchema.parse(u.rol_id) };
  }

  async buscarPorId(usuarioId: string): Promise<UsuarioAutenticado | null> {
    const filas = await conexion()<{ id: string; nombre: string; rol_id: string }[]>`
      SELECT id, nombre, rol_id FROM usuario WHERE id = ${usuarioId} AND activo LIMIT 1`;

    const u = filas[0];
    if (!u) return null;
    return { usuarioId: u.id, nombre: u.nombre, rol: RolSchema.parse(u.rol_id) };
  }

  async bodegasDe(usuarioId: string): Promise<{ id: string; nombre: string }[]> {
    return conexion()<{ id: string; nombre: string }[]>`
      SELECT b.id, b.nombre
      FROM bodega b
      JOIN usuario_bodega ub ON ub.bodega_id = b.id
      WHERE ub.usuario_id = ${usuarioId} AND b.activa
      ORDER BY b.nombre`;
  }
}

/** Se expone para las semillas y para la futura administración de usuarios. */
export function hashDeClave(password: string): Promise<string> {
  return hash(password, { algorithm: 2 }); // 2 = argon2id
}
