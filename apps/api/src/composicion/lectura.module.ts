import { Module } from '@nestjs/common';

import { AuditoriaModule } from '../modules/auditoria/auditoria.module';
import { ConsolidacionModule } from '../modules/consolidacion/consolidacion.module';
import { IntegracionModule } from '../modules/integracion/integracion.module';

/**
 * Raíz de composición de las interfaces de LECTURA.
 *
 * Lo que cruza esta frontera son tres interfaces sin un solo método que
 * escriba. Que el modo consulta sea de solo lectura no queda confiado a la
 * disciplina de quien lo mantenga: las operaciones de escritura no están
 * inyectadas, así que no hay forma de llamarlas.
 */
@Module({
  imports: [ConsolidacionModule, AuditoriaModule, IntegracionModule],
  exports: [ConsolidacionModule, AuditoriaModule, IntegracionModule],
})
export class LecturaModule {}
