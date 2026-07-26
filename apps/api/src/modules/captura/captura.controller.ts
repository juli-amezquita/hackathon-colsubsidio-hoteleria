import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import {
  CierreRondaSchema,
  EvidenciaEntradaSchema,
  ProductoFantasmaEntradaSchema,
  RegistroEntradaSchema,
  ResolucionEntradaSchema,
  type ArticuloDeTrabajo,
  type RegistroAceptado,
  type ResolucionArticulo,
  type Ronda,
} from '@cci/contracts';

import { z } from 'zod';

import { ZodPipe } from '../../platform/validacion/zod.pipe';
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
/**
 * Abrir una ronda es la primera frontera de entrada del sistema. No vivía en
 * `@cci/contracts` porque nadie la validaba; queda aquí junto a su única ruta
 * hasta que el paquete de contratos la absorba.
 */
const AperturaRondaSchema = z.object({
  bodegaId: z.string().uuid(),
  // El reloj del dispositivo, para medir su desfase (D-16). Opcional: sin él
  // el desfase es 0, que es exactamente lo que significa no saberlo.
  epochCliente: z.number().int().finite().optional(),
});

@Controller('rondas')
export class CapturaController {
  constructor(
    @Inject(RondaService) private readonly rondas: RondaService,
    @Inject(PROVEEDOR_CATALOGO) private readonly catalogo: ProveedorDeCatalogo,
  ) {}

  @Post()
  @Roles('operador')
  abrir(
    // Era la ÚNICA ruta con cuerpo sin validar de toda la API (Principio VI).
    // Un `{}` dejaba `bodegaId` en `undefined`, postgres.js lanzaba
    // UNDEFINED_VALUE y el operario recibía un 500 al abrir su ronda — el
    // primer paso de todo el flujo.
    @Body(new ZodPipe(AperturaRondaSchema)) datos: { bodegaId: string; epochCliente?: number },
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

  /**
   * H2-05 · Evidencia de un conteo sostenido pese a una alerta (FR-2.4).
   *
   * Va aparte del registro porque llega después: el audio se sube cuando hay
   * red, y el conteo no puede esperar a que la haya (D-07, F-18).
   */
  @Post(':rondaId/registros/:registroId/evidencia')
  @Roles('operador')
  evidencia(
    @Param('rondaId') rondaId: string,
    @Param('registroId') registroId: string,
    @Body(cuerpo(EvidenciaEntradaSchema)) datos: never,
    @Req() req: PeticionAutenticada,
  ) {
    return this.rondas.adjuntarEvidencia(rondaId, req.usuario!.usuarioId, registroId, datos);
  }

  /**
   * H5-01 · Hallazgo sin correspondencia en el catálogo (FR-5.1).
   *
   * Ruta aparte de `/registros` a propósito: un fantasma no es un conteo con
   * el nombre en blanco, es otra clase de hecho.
   */
  @Post(':rondaId/fantasmas')
  @Roles('operador')
  fantasma(
    @Param('rondaId') rondaId: string,
    @Body(cuerpo(ProductoFantasmaEntradaSchema)) entrada: never,
    @Req() req: PeticionAutenticada,
  ) {
    return this.rondas.registrarFantasma(rondaId, req.usuario!.usuarioId, entrada);
  }

  /**
   * H6-02 a H6-04 · Por dónde iba la ronda, según el servidor.
   *
   * El dispositivo lleva su propia cola y su propio historial; esto es la
   * fuente de verdad para cuando esa memoria se pierde — y para enterarse de
   * las alertas que llegaron mientras el operario ya iba en otro estante.
   */
  @Get(':rondaId/estado')
  @Roles('operador')
  estado(@Param('rondaId') rondaId: string, @Req() req: PeticionAutenticada) {
    return this.rondas.estadoDeRonda(rondaId, req.usuario!.usuarioId);
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
