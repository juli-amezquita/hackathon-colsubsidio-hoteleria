import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ReconteoEntradaSchema } from '@cci/contracts';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { AuditoriaService } from './auditoria.service';

/**
 * H4-01 a H4-04 · La superficie del Auditor.
 *
 * ⚠️ **Este es el único controlador cuyas respuestas contienen el saldo
 * esperado.** Ninguna ruta lleva `@Roles('operador')` y ninguna puede llevarlo:
 * el día que alguien lo añadiera por comodidad, el conteo dejaría de ser ciego
 * y la garantía de D5 se caería sin que ninguna prueba de captura fallara.
 *
 * La prueba E5 verifica que un Operador recibe 403 en cada una de estas rutas.
 */
@Controller('auditoria')
export class AuditoriaController {
  constructor(@Inject(AuditoriaService) private readonly auditoria: AuditoriaService) {}

  /** El catálogo controlado de causas (R4, FR-4.4). */
  @Get('codigos-razon')
  @Roles('auditor', 'administrador')
  async razones() {
    return { items: await this.auditoria.codigosDeRazon() };
  }

  /** Lo que falta por resolver en la bodega (FR-4.8). */
  @Get('bodegas/:bodegaId/pendientes')
  @Roles('auditor', 'administrador')
  async pendientes(@Param('bodegaId') bodegaId: string) {
    return { items: await this.auditoria.pendientes(bodegaId) };
  }

  /** El caso completo: qué contó cada ronda, la diferencia, y la síntesis. */
  @Get('bodegas/:bodegaId/articulos/:articuloId')
  @Roles('auditor', 'administrador')
  caso(
    @Param('bodegaId') bodegaId: string,
    @Param('articuloId') articuloId: string,
    @Req() req: PeticionAutenticada,
  ) {
    return this.auditoria.caso(bodegaId, articuloId, req.usuario!.usuarioId);
  }

  /** El caso de un hallazgo sin catálogo (H5-05). */
  @Get('bodegas/:bodegaId/fantasmas/:fantasmaId')
  @Roles('auditor', 'administrador')
  fantasma(@Param('bodegaId') bodegaId: string, @Param('fantasmaId') fantasmaId: string) {
    return this.auditoria.casoFantasma(bodegaId, fantasmaId);
  }

  /** Resuelve un hallazgo sin catálogo. Con causa, igual que un artículo. */
  @Post('bodegas/:bodegaId/fantasmas/:fantasmaId/resolucion')
  @Roles('auditor')
  resolverFantasma(
    @Param('bodegaId') bodegaId: string,
    @Param('fantasmaId') fantasmaId: string,
    @Body(cuerpo(ReconteoEntradaSchema)) entrada: never,
    @Req() req: PeticionAutenticada,
  ) {
    return this.auditoria.resolverFantasma(bodegaId, fantasmaId, req.usuario!.usuarioId, entrada);
  }

  /** El reconteo, con su causa. Prevalece sobre el conteo de los Operadores. */
  @Post('bodegas/:bodegaId/articulos/:articuloId/reconteo')
  @Roles('auditor')
  recontar(
    @Param('bodegaId') bodegaId: string,
    @Param('articuloId') articuloId: string,
    @Body(cuerpo(ReconteoEntradaSchema)) entrada: never,
    @Req() req: PeticionAutenticada,
  ) {
    return this.auditoria.recontar(bodegaId, articuloId, req.usuario!.usuarioId, entrada);
  }
}
