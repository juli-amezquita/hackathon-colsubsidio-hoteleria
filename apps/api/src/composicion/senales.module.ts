import { Module } from '@nestjs/common';

import { AuditoriaModule } from '../modules/auditoria/auditoria.module';
import { CapturaModule } from '../modules/captura/captura.module';

/**
 * Raíz de composición de las señales de aprendizaje.
 *
 * Existe por la misma razón que `DominiosModule` —un dominio no importa a
 * otro— y aparte de él por una razón concreta: `captura` importa
 * `DominiosModule` para consumir el catálogo, así que meter `CapturaModule`
 * allí crearía un ciclo. Aquí no lo hay, porque nadie consume este módulo
 * salvo `aprendizaje`, que es terminal.
 *
 * Lo que cruza esta frontera son señales YA interpretadas: cada dominio lee sus
 * propias tablas y entrega números. `aprendizaje` no conoce una sola columna de
 * los otros dos.
 */
@Module({
  imports: [CapturaModule, AuditoriaModule],
  exports: [CapturaModule, AuditoriaModule],
})
export class SenalesModule {}
