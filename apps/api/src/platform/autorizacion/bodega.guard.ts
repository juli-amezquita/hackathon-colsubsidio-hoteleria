import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { conexion } from '../db/cliente';
import type { PeticionAutenticada } from './sesion.guard';

/**
 * F-15b · El rol dice QUÉ puedes hacer; esto dice SOBRE QUÉ.
 *
 * `SesionGuard` comprueba el rol y ahí se paraba todo. El resultado era que
 * cualquier persona con rol de Auditor podía leer —y cerrar— el inventario de
 * una bodega que no le corresponde con solo cambiar el UUID de la URL:
 *
 *     GET  /auditoria/bodegas/<uuid-de-otra-sede>/pendientes   → 200, con saldos
 *     POST /integracion/bodegas/<uuid-de-otra-sede>/cierre     → 200, tabla madre movida
 *
 * Y el UUID no es un secreto: viaja en cualquier respuesta compartida, en un
 * enlace pegado por chat o en la sesión anterior del mismo puesto.
 *
 * En todo el sistema solo había DOS sitios que consultaran `usuario_bodega`:
 * abrir una ronda y listar las bodegas propias. Toda la superficie de Auditor,
 * Administrador y Supervisor quedaba fuera.
 *
 * Esta guarda es global y automática a propósito. Comprobarlo controlador por
 * controlador exige acordarse en cada ruta nueva, y el olvido no se nota: la
 * ruta funciona igual de bien para el dueño de la bodega y para quien no lo es.
 */
@Injectable()
export class BodegaGuard implements CanActivate {
  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<PeticionAutenticada>();

    // Sin usuario, `SesionGuard` ya rechazó o la ruta es pública. Aquí no se
    // reautentica nada: esta guarda solo responde "¿esta bodega es suya?".
    if (!req.usuario) return true;

    const bodegaId = extraer(req);
    if (!bodegaId) return true;

    const [fila] = await conexion()<{ n: number }[]>`
      SELECT 1 AS n FROM usuario_bodega
      WHERE usuario_id = ${req.usuario.usuarioId} AND bodega_id = ${bodegaId}`;

    if (!fila) {
      // El mismo mensaje que un rol insuficiente. Distinguir "no es tuya" de
      // "no existe" permitiría enumerar las bodegas de la compañía probando
      // identificadores.
      throw new ForbiddenException({ codigo: 'PROHIBIDO', mensaje: 'Su rol no permite esta operación.' });
    }
    return true;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * De dónde sale la bodega de una petición.
 *
 * Un identificador que no tiene forma de UUID se ignora en vez de rechazarse:
 * llegaría igualmente a Postgres, que devolvería 22P02, y esta guarda no es el
 * sitio donde se valida el formato de las entradas.
 */
function extraer(req: PeticionAutenticada): string | null {
  const params = (req.params ?? {}) as Record<string, string>;
  const query = (req.query ?? {}) as Record<string, string>;
  const candidato = params['bodegaId'] ?? query['bodegaId'] ?? query['bodega'];
  return typeof candidato === 'string' && UUID.test(candidato) ? candidato : null;
}
