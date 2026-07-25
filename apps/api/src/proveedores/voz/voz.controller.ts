import { Controller, Inject, Param, Post } from '@nestjs/common';

import { Roles } from '../../platform/autorizacion/decoradores';
import { PROVEEDOR_VOZ, type CredencialDeVoz, type ProveedorDeVoz } from './proveedor';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { Req } from '@nestjs/common';

@Controller('voz')
export class VozController {
  constructor(@Inject(PROVEEDOR_VOZ) private readonly voz: ProveedorDeVoz) {}

  /**
   * Emite la credencial efímera con la que el dispositivo habla directo con el
   * proveedor de transcripción (D-07-A).
   *
   * Es POST y no GET a propósito: emitir una credencial es un efecto, y un GET
   * es cacheable, prefetcheable y termina en historiales y logs de proxy.
   */
  @Post('token/:rondaId')
  @Roles('operador', 'auditor')
  emitir(
    @Param('rondaId') rondaId: string,
    @Req() req: PeticionAutenticada,
  ): Promise<CredencialDeVoz> {
    return this.voz.emitirCredencial({ usuarioId: req.usuario!.usuarioId, rondaId });
  }
}
