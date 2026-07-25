import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import { AliasAprobadoSchema } from '@cci/contracts';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { AprendizajeService } from './aprendizaje.service';

/**
 * El reporte con el que el sistema se examina a sí mismo.
 *
 * No es para el Operador: mezcla señales de todas las rondas y todos los
 * auditores, y leer las métricas de calidad de la propia captura mientras se
 * cuenta no ayuda a contar. Es un instrumento de quien opera el sistema.
 */
@Controller('aprendizaje')
export class AprendizajeController {
  constructor(@Inject(AprendizajeService) private readonly aprendizaje: AprendizajeService) {}

  /**
   * El reporte del periodo. Por defecto, los últimos 30 días.
   *
   * `?bodegaId=` lo acota a una bodega, que es como se lee cuando hay que
   * decidir dónde poner alias: los patrones de habla son locales.
   */
  @Get('reporte')
  @Roles('auditor', 'administrador')
  reporte(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('bodegaId') bodegaId?: string,
  ) {
    const fin = hasta ? new Date(hasta) : new Date();
    const inicio = desde ? new Date(desde) : new Date(fin.getTime() - 30 * 24 * 3600 * 1000);

    return this.aprendizaje.reporte({
      desde: inicio.toISOString(),
      hasta: fin.toISOString(),
      ...(bodegaId ? { bodegaId } : {}),
    });
  }

  /**
   * Aprueba una propuesta de alias.
   *
   * Es el único endpoint del sistema donde una mejora del propio sistema se
   * aplica — y lo aplica una persona, con la evidencia delante, en un cambio de
   * datos reversible que queda con su nombre.
   */
  @Post('alias')
  @Roles('administrador')
  aplicar(
    @Body(cuerpo(AliasAprobadoSchema)) datos: { bodegaId: string; articuloId: string; alias: string },
    @Req() req: PeticionAutenticada,
  ) {
    return this.aprendizaje.aplicarAlias(
      datos.bodegaId, datos.articuloId, datos.alias, req.usuario!.usuarioId,
    );
  }
}
