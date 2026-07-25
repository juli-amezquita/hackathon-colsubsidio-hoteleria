import { Module } from '@nestjs/common';

import { config } from '../../config';
import { ArbitroAnthropic } from '../../proveedores/arbitraje/anthropic';
import { ArbitroDeterminista } from '../../proveedores/arbitraje/determinista';
import { PROVEEDOR_ARBITRAJE } from '../../proveedores/arbitraje/proveedor';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

/**
 * Dominio `auditoria` — frontera dura (Principio III).
 *
 * Es el dominio con el privilegio peligroso: sus respuestas llevan el saldo
 * esperado. Que viva aislado, con su propio controlador y su propio control de
 * rol, es lo que hace que ese privilegio no se filtre por accidente a una ruta
 * de conteo.
 *
 * El árbitro se elige en el arranque y siempre tiene alternativa (Restricción
 * 5): sin clave de Anthropic, el determinista ordena el mismo caso con reglas.
 */
@Module({
  controllers: [AuditoriaController],
  providers: [
    AuditoriaService,
    ArbitroDeterminista,
    {
      provide: PROVEEDOR_ARBITRAJE,
      useClass: config().PROVEEDOR_ARBITRAJE === 'anthropic' ? ArbitroAnthropic : ArbitroDeterminista,
    },
  ],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
