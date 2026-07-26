import {
  BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { AliasAprobadoSchema, DecisionPropuestaSchema } from '@cci/contracts';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { AprendizajeService } from './aprendizaje.service';
import { CriticoService } from './critico.service';

/**
 * El reporte con el que el sistema se examina a sí mismo.
 *
 * No es para el Operador: mezcla señales de todas las rondas y todos los
 * auditores, y leer las métricas de calidad de la propia captura mientras se
 * cuenta no ayuda a contar. Es un instrumento de quien opera el sistema.
 */
const ESTADOS = ['propuesta', 'aprobada', 'rechazada', 'aplicada'];

@Controller('aprendizaje')
export class AprendizajeController {
  constructor(
    @Inject(AprendizajeService) private readonly aprendizaje: AprendizajeService,
    @Inject(CriticoService) private readonly critico: CriticoService,
  ) {}

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

  /** El panel: lo que espera decisión, o lo ya decidido. */
  @Get('propuestas')
  @Roles('auditor', 'administrador')
  async propuestas(@Query('estado') estado?: string) {
    // El valor entra crudo a un `::estado_propuesta`. Cualquier cosa que no sea
    // uno de los cuatro estados produce 22P02 y un 500 con traza de Postgres.
    if (estado && !ESTADOS.includes(estado)) {
      throw new BadRequestException({
        codigo: 'ESTADO_INVALIDO',
        mensaje: `Estado no reconocido. Use uno de: ${ESTADOS.join(', ')}.`,
      });
    }
    return { items: await this.aprendizaje.listarPropuestas(estado) };
  }

  /**
   * Aprueba o rechaza una propuesta.
   *
   * Aprobar un alias lo aplica en el acto —es un dato—. Aprobar una mejora de
   * gramática la deja `aprobada` y genera trabajo para un desarrollador: eso es
   * código, y prometer que el sistema se reescribe solo sería prometer justo lo
   * que no debe hacer.
   */
  @Post('propuestas/:propuestaId/decision')
  @Roles('administrador')
  decidir(
    @Param('propuestaId') propuestaId: string,
    @Body(cuerpo(DecisionPropuestaSchema)) datos: { aprobar: boolean; nota?: string },
    @Req() req: PeticionAutenticada,
  ) {
    return this.aprendizaje.decidir(propuestaId, datos.aprobar, req.usuario!.usuarioId, datos.nota);
  }

  /**
   * La crítica de cada ronda cerrada.
   *
   * ⚠️ Evalúa al SISTEMA, no a la persona. Ningún hallazgo se refiere al
   * operario; el nombre está para poder volver al libro, no para calificarlo.
   */
  @Get('bodegas/:bodegaId/criticas')
  @Roles('auditor', 'administrador')
  async criticas(@Param('bodegaId') bodegaId: string) {
    return { items: await this.critico.criticas(bodegaId) };
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
