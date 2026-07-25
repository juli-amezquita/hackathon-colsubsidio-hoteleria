import { Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Roles } from '../../platform/autorizacion/decoradores';
import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';
import { aCsv, aXlsx } from './exportacion';
import { IntegracionService } from './integracion.service';

/**
 * H7-01 a H7-06 · La salida del dato.
 *
 * ⚠️ Ninguna ruta admite al Operador (FR-7.8), y no por costumbre: el
 * consolidado lleva el saldo del sistema y las diferencias contra él. Es la
 * misma frontera que sostiene la ceguera del conteo.
 */
@Controller('integracion')
export class IntegracionController {
  constructor(@Inject(IntegracionService) private readonly integracion: IntegracionService) {}

  /** El consolidado en JSON, para pintar en pantalla antes de descargarlo. */
  @Get('bodegas/:bodegaId/consolidado')
  @Roles('auditor', 'administrador')
  async consolidado(@Param('bodegaId') bodegaId: string) {
    return { items: await this.integracion.consolidado(bodegaId) };
  }

  /**
   * H7-01 · Descarga en CSV o Excel (FR-7.2).
   *
   * `?definitivo=true` exige el inventario avalado (FR-7.6). Sin esa bandera se
   * descarga un preliminar — útil a mitad del inventario y explícitamente
   * marcado como tal en el nombre del archivo, para que nadie lo confunda con
   * el que se envía al ERP.
   */
  @Get('bodegas/:bodegaId/exportacion.:formato')
  @Roles('auditor', 'administrador')
  async exportar(
    @Param('bodegaId') bodegaId: string,
    @Param('formato') formato: string,
    @Query('definitivo') definitivo: string | undefined,
    @Req() req: PeticionAutenticada,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const esDefinitivo = definitivo === 'true';
    if (esDefinitivo) await this.integracion.exigirInventarioAvalado(bodegaId);

    const filas = await this.integracion.consolidado(bodegaId);
    const marca = esDefinitivo ? 'definitivo' : 'preliminar';
    const nombre = `inventario-${marca}-${bodegaId.slice(0, 8)}`;

    // Queda constancia de la descarga: quién, qué y cuándo (FR-7.5, SC-7.3).
    await this.integracion.registrarDescarga(
      bodegaId, req.usuario!.usuarioId, formato === 'xlsx' ? 'xlsx' : 'csv', filas.length,
    );

    if (formato === 'xlsx') {
      await res
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${nombre}.xlsx"`)
        .send(aXlsx(filas, nombre));
      return;
    }

    await res
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nombre}.csv"`)
      .send(aCsv(filas));
  }

  /**
   * El aval del Auditor: cierra el inventario y mueve la tabla madre (D8).
   *
   * Es la única operación del sistema que escribe en `saldo_esperado`.
   */
  @Post('bodegas/:bodegaId/cierre')
  @Roles('auditor', 'administrador')
  cerrar(@Param('bodegaId') bodegaId: string, @Req() req: PeticionAutenticada) {
    return this.integracion.cerrarInventario(bodegaId, req.usuario!.usuarioId);
  }

  /** H7-03, H7-04 · Envío al sistema central. Reintentar no duplica. */
  @Post('bodegas/:bodegaId/envio')
  @Roles('administrador')
  enviar(@Param('bodegaId') bodegaId: string, @Req() req: PeticionAutenticada) {
    return this.integracion.enviarAlErp(bodegaId, req.usuario!.usuarioId);
  }

  /** H7-05 · Qué salió, cuándo y por quién. */
  @Get('bodegas/:bodegaId/constancias')
  @Roles('auditor', 'administrador')
  async constancias(@Param('bodegaId') bodegaId: string) {
    return { items: await this.integracion.constancias(bodegaId) };
  }
}
