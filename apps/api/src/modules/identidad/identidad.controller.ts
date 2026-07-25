import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { CredencialesSchema, type Sesion } from '@cci/contracts';
import type { FastifyReply } from 'fastify';

import {
  PROVEEDOR_IDENTIDAD,
  type ProveedorDeIdentidad,
} from '../../platform/dominio/identidad';
import { Publico, Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { SesionService } from './sesion.service';

@Controller('sesion')
export class IdentidadController {
  /**
   * Los tokens van EXPLÍCITOS en cada parámetro, incluso donde el tipo bastaría.
   *
   * La inyección por tipo depende de `emitDecoratorMetadata`, que esbuild —y con
   * él tsx y vitest— no implementa. Sin esto, la aplicación funciona compilada
   * con `tsc` y falla bajo las pruebas: la peor clase de diferencia entre
   * entornos, porque el build que se despliega no es el que se prueba.
   */
  constructor(
    @Inject(PROVEEDOR_IDENTIDAD) private readonly identidad: ProveedorDeIdentidad,
    @Inject(SesionService) private readonly sesiones: SesionService,
  ) {}

  @Post()
  @Publico()
  @HttpCode(200)
  async iniciar(
    @Body(cuerpo(CredencialesSchema)) datos: { usuario: string; password: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<Sesion> {
    const usuario = await this.identidad.autenticar(datos.usuario, datos.password);

    // Un solo mensaje para credenciales malas, usuario inexistente y cuenta
    // inactiva. Distinguirlos permitiría enumerar usuarios (OWASP A07).
    if (!usuario) {
      throw new UnauthorizedException({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Usuario o contraseña incorrectos.',
      });
    }

    const { valor, expiraEn } = this.sesiones.emitir(usuario.usuarioId, usuario.rol);
    void res.setCookie(this.sesiones.nombreCookie, valor, this.sesiones.opcionesCookie(expiraEn));

    return {
      usuarioId: usuario.usuarioId,
      nombre: usuario.nombre,
      // El rol se DEDUCE de la base; el usuario nunca lo elige (FR-1.2).
      rol: usuario.rol,
      bodegas: await this.identidad.bodegasDe(usuario.usuarioId),
    };
  }

  @Get()
  @Roles('operador', 'auditor', 'administrador')
  async actual(@Req() req: PeticionAutenticada): Promise<Sesion> {
    const usuario = await this.identidad.buscarPorId(req.usuario!.usuarioId);
    if (!usuario) throw new UnauthorizedException({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión inválida.' });

    return {
      usuarioId: usuario.usuarioId,
      nombre: usuario.nombre,
      rol: usuario.rol,
      bodegas: await this.identidad.bodegasDe(usuario.usuarioId),
    };
  }

  @Post('cierre')
  @Roles('operador', 'auditor', 'administrador')
  @HttpCode(204)
  cerrar(@Res({ passthrough: true }) res: FastifyReply): void {
    void res.clearCookie(this.sesiones.nombreCookie, this.sesiones.opcionesCookie());
  }
}
