import { Controller, Inject, Param, Post, Req } from '@nestjs/common';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { PROVEEDOR_CATALOGO, type ProveedorDeCatalogo } from '../../platform/dominio/catalogo';
import { PROVEEDOR_RONDAS, type ProveedorDeRondas } from '../../platform/dominio/rondas';
import { PROVEEDOR_VOZ, type CredencialDeVoz, type ProveedorDeVoz } from './proveedor';

@Controller('voz')
export class VozController {
  constructor(
    @Inject(PROVEEDOR_VOZ) private readonly voz: ProveedorDeVoz,
    @Inject(PROVEEDOR_CATALOGO) private readonly catalogo: ProveedorDeCatalogo,
    @Inject(PROVEEDOR_RONDAS) private readonly rondas: ProveedorDeRondas,
  ) {}

  /**
   * Emite la credencial efímera con la que el dispositivo habla directo con el
   * proveedor de transcripción (D-07-A).
   *
   * Es POST y no GET a propósito: emitir una credencial es un efecto, y un GET
   * es cacheable, prefetcheable y termina en historiales y logs de proxy.
   *
   * La credencial viaja con el **vocabulario de la bodega**. El transcriptor
   * decide entre "acelga" y "aceite" con un modelo general del español; con el
   * catálogo delante decide entre las palabras que pueden aparecer en ESA
   * bodega. Es la mejora más barata que tiene el sistema: el dato ya existe.
   */
  @Post('token/:rondaId')
  @Roles('operador', 'auditor')
  async emitir(
    @Param('rondaId') rondaId: string,
    @Req() req: PeticionAutenticada,
  ): Promise<CredencialDeVoz> {
    // Si el catálogo falla, se emite la credencial SIN vocabulario en vez de
    // negar la voz: transcribir peor es un problema; no poder contar, otro.
    const terminos = await this.rondas
      .bodegaDeRondaPropia(rondaId, req.usuario!.usuarioId)
      .then((bodegaId) => this.catalogo.listar(bodegaId))
      .then((items) => items.map((a) => a.nombre))
      .catch(() => []);

    return this.voz.emitirCredencial({ usuarioId: req.usuario!.usuarioId, rondaId, terminos });
  }
}
