import { Module } from '@nestjs/common';

import { AutopulidoService } from './autopulido.service';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';

/**
 * El Dashboard Administrativo.
 *
 * No importa ningún otro dominio y ninguno lo importa a él: es un consumidor de
 * LECTURA del histórico de cierres y de la crítica de rondas. Esa frontera es
 * deliberada — si mañana el tablero se lleva a otro servicio, se lleva entero y
 * sin tocar la lógica de conteo (Principio III).
 */
@Module({
  controllers: [MetricasController],
  providers: [MetricasService, AutopulidoService],
  exports: [MetricasService],
})
export class MetricasModule {}
