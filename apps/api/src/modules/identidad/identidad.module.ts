import { Module } from '@nestjs/common';

import { PROVEEDOR_IDENTIDAD } from '../../platform/dominio/identidad';
import { IdentidadController } from './identidad.controller';
import { PadronPropio } from './padron.proveedor';
import { SesionService } from './sesion.service';

/**
 * Dominio `identidad` — frontera dura (Principio III).
 *
 * Exporta `SesionService` porque la guarda global lo necesita para verificar la
 * cookie, y `PROVEEDOR_IDENTIDAD` como interfaz publicada (D3). Nada más sale
 * de aquí: el hashing y las tablas son internos.
 */
@Module({
  controllers: [IdentidadController],
  providers: [SesionService, { provide: PROVEEDOR_IDENTIDAD, useClass: PadronPropio }],
  exports: [SesionService, PROVEEDOR_IDENTIDAD],
})
export class IdentidadModule {}
