import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import {
  CierreRondaSchema,
  RegistroEntradaSchema,
  ResolucionEntradaSchema,
  type ArticuloDeTrabajo,
  type RegistroAceptado,
  type ResolucionArticulo,
  type Ronda,
} from '@cci/contracts';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { PROVEEDOR_CATALOGO, type ProveedorDeCatalogo } from '../../platform/dominio/catalogo';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { RondaService } from './ronda.service';

/**
 * H1-03 · La superficie del conteo.
 *
 * ⚠️ **Ninguna respuesta de este controlador contiene el saldo esperado**, ni
 * el valor, ni un rango, ni nada de lo que se derive (FR-1.18). No es una
 * convención: los tipos que devuelve no tienen dónde ponerlo, y la prueba E2
 * recorre todas las respuestas para comprobarlo.
 */
@Controller('rondas')
export class CapturaController {
  constructor(
    @Inject(RondaService) private readonly rondas: RondaService,
    @Inject(PROVEEDOR_CATALOGO) private readonly catalogo: ProveedorDeCatalogo,
  ) {}

  @Post()
  @Roles('operador')
  abrir(
    @Body() datos: { bodegaId: string; epochCliente?: number },
    @Req() req: PeticionAutenticada,
  ): Promise<Ronda> {
    return this.rondas.abrir(datos.bodegaId, req.usuario!.usuarioId, datos.epochCliente);
  }

  /** El catálogo que el dispositivo cachea para resolver nombres sin red (F-21). */
  @Get(':rondaId/catalogo')
  @Roles('operador')
  async catalogoDe(@Param('rondaId') rondaId: string, @Req() req: PeticionAutenticada): Promise<{ items: ArticuloDeTrabajo[] }> {
    const bodegaId = await this.bodegaDe(rondaId, req);
    return { items: await this.catalogo.listar(bodegaId) };
  }

  /** Ruta caliente: resuelve el nombre dictado o devuelve candidatos. */
  @Post(':rondaId/resolucion-articulo')
  @Roles('operador')
  async resolver(
    @Param('rondaId') rondaId: string,
    @Body(cuerpo(ResolucionEntradaSchema)) datos: { textoDictado: string },
    @Req() req: PeticionAutenticada,
  ): Promise<ResolucionArticulo> {
    const bodegaId = await this.bodegaDe(rondaId, req);
    return this.catalogo.resolver(bodegaId, datos.textoDictado);
  }

  @Post(':rondaId/registros')
  @Roles('operador')
  registrar(
    @Param('rondaId') rondaId: string,
    @Body(cuerpo(RegistroEntradaSchema)) entrada: never,
    @Req() req: PeticionAutenticada,
  ): Promise<RegistroAceptado> {
    return this.rondas.registrar(rondaId, req.usuario!.usuarioId, entrada);
  }

  @Get(':rondaId/cuadre-cierre')
  @Roles('operador')
  cuadre(@Param('rondaId') rondaId: string, @Req() req: PeticionAutenticada) {
    return this.rondas.cuadreDeCierre(rondaId, req.usuario!.usuarioId);
  }

  @Post(':rondaId/cierre')
  @Roles('operador')
  cerrar(
    @Param('rondaId') rondaId: string,
    @Body(cuerpo(CierreRondaSchema)) datos: { decisiones: never[] },
    @Req() req: PeticionAutenticada,
  ) {
    return this.rondas.cerrar(rondaId, req.usuario!.usuarioId, datos.decisiones);
  }

  private async bodegaDe(rondaId: string, req: PeticionAutenticada): Promise<string> {
    return this.rondas.bodegaDeRonda(rondaId, req.usuario!.usuarioId);
  }
}
