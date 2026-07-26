import { Module } from '@nestjs/common';

import { IdentidadModule } from '../identidad/identidad.module';
import { PresenciaGateway } from './presencia.gateway';
import { PresenciaService } from './presencia.service';

/**
 * Presencia en vivo. Avisa quién está contando; nunca qué han contado.
 */
@Module({
  imports: [IdentidadModule],
  providers: [PresenciaService, PresenciaGateway],
  exports: [PresenciaGateway],
})
export class PresenciaModule {}
