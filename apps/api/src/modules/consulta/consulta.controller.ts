import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PreguntaSchema } from '@cci/contracts';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import {
  PROVEEDOR_AGENTE_VOZ,
  type CredencialDeAgente,
  type ProveedorDeAgenteDeVoz,
} from '../../proveedores/agente-voz/proveedor';
import { cuerpo } from '../../platform/validacion/zod.pipe';
import { ConsultaService } from './consulta.service';

/** Minutos que se reservan al abrir una sesión de voz. */
const MINUTOS_POR_SESION = 5;

/**
 * H9-01 · El modo consulta. **Supervisor y Administrador, nadie más.**
 *
 * Ni el Operador ni el Auditor entran, y el Operador por la razón de siempre:
 * estas respuestas llevan saldos y diferencias. El Auditor queda fuera porque
 * su trabajo es su bandeja, no un resumen conversacional — y menos superficie
 * es menos que defender.
 */
@Controller('consulta')
export class ConsultaController {
  constructor(
    @Inject(ConsultaService) private readonly consulta: ConsultaService,
    @Inject(PROVEEDOR_AGENTE_VOZ) private readonly agente: ProveedorDeAgenteDeVoz,
  ) {}

  /**
   * Pregunta por texto. Es la vía principal, no un respaldo.
   *
   * Responde exactamente lo mismo que el agente de voz porque las dos pasan por
   * el mismo catálogo cerrado de preguntas. Si el proveedor conversacional no
   * existiera, el modo consulta seguiría funcionando entero (Restricción 5).
   */
  @Post('bodegas/:bodegaId')
  @Roles('supervisor', 'administrador')
  preguntar(
    @Param('bodegaId') bodegaId: string,
    @Body(cuerpo(PreguntaSchema)) datos: { pregunta: string },
  ) {
    return this.consulta.responder(bodegaId, datos.pregunta);
  }

  /**
   * Credencial del agente conversacional, con el cupo del mes.
   *
   * Falla si el proveedor configurado no está verificado (H9-03): endpoint y
   * tarifa vienen del brief y comprometer un presupuesto con un número que
   * nadie confirmó es como se llega a una factura que nadie esperaba.
   */
  @Post('bodegas/:bodegaId/voz')
  @Roles('supervisor', 'administrador')
  async voz(
    @Param('bodegaId') bodegaId: string,
    @Req() req: PeticionAutenticada,
  ): Promise<CredencialDeAgente> {
    if (!this.agente.verificado) {
      throw new BadRequestException({
        codigo: 'AGENTE_NO_VERIFICADO',
        mensaje:
          `El proveedor "${this.agente.nombre}" no tiene endpoint ni tarifa verificados (H9-03). ` +
          'Use la consulta por texto, que responde lo mismo.',
      });
    }

    const cupo = await this.consulta.reservarMinutos(req.usuario!.usuarioId, MINUTOS_POR_SESION);
    const credencial = await this.agente.emitirCredencial({
      usuarioId: req.usuario!.usuarioId,
      bodegaId,
    });

    return { ...credencial, cupo };
  }

  /** H9-02 · El consumo del mes. Lo mira quien paga la factura. */
  @Get('consumo')
  @Roles('administrador')
  consumo(@Query('periodo') periodo?: string) {
    return this.consulta.consumo(periodo);
  }
}
