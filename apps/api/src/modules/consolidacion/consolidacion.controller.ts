import { Controller, Get, Inject, Param } from '@nestjs/common';

import { Roles } from '../../platform/autorizacion/decoradores';
import { ConsolidacionService } from './consolidacion.service';

/**
 * H3-03 · La superficie de lectura del consolidado.
 *
 * ⚠️ Ninguna ruta lleva `@Roles('operador')`, y es deliberado: el consolidado
 * contiene el saldo esperado congelado y las diferencias contra él. Es
 * exactamente lo que FR-1.18 prohíbe mostrarle a quien cuenta.
 *
 * La guarda global niega por defecto, así que un rol que no esté en la lista no
 * entra aunque nadie se acuerde de comprobarlo.
 */
@Controller('bodegas')
export class ConsolidacionController {
  constructor(@Inject(ConsolidacionService) private readonly consolidacion: ConsolidacionService) {}

  @Get(':bodegaId/consolidado')
  @Roles('auditor', 'administrador')
  resumen(@Param('bodegaId') bodegaId: string) {
    return this.consolidacion.resumen(bodegaId);
  }

  /** La bandeja del Auditor: 8 artículos en vez de 800. */
  @Get(':bodegaId/auditables')
  @Roles('auditor', 'administrador')
  async auditables(@Param('bodegaId') bodegaId: string) {
    return { items: await this.consolidacion.auditables(bodegaId) };
  }

  /** Qué contó cada ronda y quién la ejecutó (FR-3.1, escenario 8). */
  @Get(':bodegaId/articulos/:articuloId/rondas')
  @Roles('auditor', 'administrador')
  async detalle(@Param('bodegaId') bodegaId: string, @Param('articuloId') articuloId: string) {
    return { rondas: await this.consolidacion.detallePorRonda(bodegaId, articuloId) };
  }
}
