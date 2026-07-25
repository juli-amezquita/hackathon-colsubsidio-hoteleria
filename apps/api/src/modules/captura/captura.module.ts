import { Module } from '@nestjs/common';

import { CatalogoModule } from '../catalogo/catalogo.module';
import { EVENT_BUS } from '../../platform/eventos/bus';
import { OutboxBus } from '../../platform/eventos/outbox';
import { CapturaController } from './captura.controller';
import { RondaService } from './ronda.service';

/**
 * Dominio `captura` — frontera dura (Principio III).
 *
 * Consume `catalogo` ÚNICAMENTE por su interfaz publicada (`PROVEEDOR_CATALOGO`).
 * No importa `ResolucionService`, no conoce su SQL y no toca sus tablas: la
 * regla de lint lo verifica en cada build.
 */
@Module({
  imports: [CatalogoModule],
  controllers: [CapturaController],
  providers: [RondaService, { provide: EVENT_BUS, useClass: OutboxBus }],
})
export class CapturaModule {}
