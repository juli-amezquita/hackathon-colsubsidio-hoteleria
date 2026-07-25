import { Body, Controller, Get, Inject, Param, Put, Query, Req } from '@nestjs/common';
import { ToleranciaEntradaSchema } from '@cci/contracts';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { MermasService } from './mermas.service';

/**
 * H8-01 · El panel del Administrador. **Y solo del Administrador** (FR-8.1).
 *
 * Quien mueve la tolerancia mueve el umbral de todo el control: un Operador con
 * acceso a esta ruta podría subir la merma hasta que su propio conteo dejara de
 * alertar. Por eso no hay ninguna ruta con otro rol, ni de lectura.
 */
@Controller('administracion/mermas')
export class MermasController {
  constructor(@Inject(MermasService) private readonly mermas: MermasService) {}

  @Get()
  @Roles('administrador')
  async listar() {
    return { items: await this.mermas.listar() };
  }

  @Put(':unidadId')
  @Roles('administrador')
  fijar(
    @Param('unidadId') unidadId: string,
    @Body(cuerpo(ToleranciaEntradaSchema)) datos: { porcentaje: number },
    @Req() req: PeticionAutenticada,
  ) {
    return this.mermas.fijar(unidadId, datos.porcentaje, req.usuario!.usuarioId);
  }

  @Get('historial')
  @Roles('administrador')
  async historial(@Query('unidadId') unidadId?: string) {
    return { items: await this.mermas.historial(unidadId) };
  }
}
