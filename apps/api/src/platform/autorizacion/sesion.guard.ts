import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Rol } from '@cci/contracts';
import type { FastifyRequest } from 'fastify';

import { SesionService } from '../../modules/identidad/sesion.service';
import { CLAVE_PUBLICO, CLAVE_ROLES } from './decoradores';

export interface PeticionAutenticada extends FastifyRequest {
  usuario?: { usuarioId: string; rol: Rol };
}

/**
 * Guarda global. Se registra en `main.ts` para TODA la aplicación, no ruta por
 * ruta: si dependiera de recordar ponerla, algún día alguien no la pondría.
 */
@Injectable()
export class SesionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SesionService) private readonly sesiones: SesionService,
  ) {}

  canActivate(contexto: ExecutionContext): boolean {
    const objetivos = [contexto.getHandler(), contexto.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, objetivos)) return true;

    const req = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    const contenido = this.sesiones.verificar(cookies[this.sesiones.nombreCookie]);

    if (!contenido) throw new UnauthorizedException({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión inválida o expirada.' });

    req.usuario = { usuarioId: contenido.sub, rol: contenido.rol };

    const permitidos = this.reflector.getAllAndOverride<Rol[]>(CLAVE_ROLES, objetivos);

    // Sin @Roles ni @Publico la ruta no la puede usar nadie. Es deliberado.
    if (!permitidos || permitidos.length === 0) {
      throw new ForbiddenException({
        codigo: 'SIN_AUTORIZACION_DECLARADA',
        mensaje: 'La ruta no declara qué roles la pueden usar.',
      });
    }

    if (!permitidos.includes(contenido.rol)) {
      throw new ForbiddenException({ codigo: 'PROHIBIDO', mensaje: 'Su rol no permite esta operación.' });
    }

    return true;
  }
}
