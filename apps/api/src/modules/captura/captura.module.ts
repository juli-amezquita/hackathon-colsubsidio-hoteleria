import { Module } from '@nestjs/common';

import { DominiosModule } from '../../composicion/dominios.module';
import { PROVEEDOR_RONDAS } from '../../platform/dominio/rondas';
import { EVENT_BUS } from '../../platform/eventos/bus';
import { OutboxBus } from '../../platform/eventos/outbox';
import { CapturaController } from './captura.controller';
import { RondaService } from './ronda.service';

/**
 * Dominio `captura` — frontera dura (Principio III).
 *
 * Consume `catalogo` ÚNICAMENTE por su interfaz publicada (`PROVEEDOR_CATALOGO`),
 * que le llega desde la raíz de composición. No importa `CatalogoModule`, no
 * conoce su SQL y no toca sus tablas: la regla de lint lo verifica en cada
 * build — y de hecho lo pilló.
 */
@Module({
  imports: [DominiosModule],
  controllers: [CapturaController],
  providers: [
    RondaService,
    { provide: EVENT_BUS, useClass: OutboxBus },
    { provide: PROVEEDOR_RONDAS, useExisting: RondaService },
  ],
  exports: [PROVEEDOR_RONDAS],
})
export class CapturaModule {}
