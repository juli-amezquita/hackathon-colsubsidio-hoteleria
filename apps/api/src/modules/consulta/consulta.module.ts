import { Module } from '@nestjs/common';

import { LecturaModule } from '../../composicion/lectura.module';
import { config } from '../../config';
import { AgenteGrok } from '../../proveedores/agente-voz/grok';
import { PROVEEDOR_AGENTE_VOZ } from '../../proveedores/agente-voz/proveedor';
import { AgenteSimulado } from '../../proveedores/agente-voz/simulado';
import { ConsultaController } from './consulta.controller';
import { ConsultaService } from './consulta.service';

/**
 * Dominio `consulta` — el modo supervisor (D-10, Historia extra).
 *
 * Consume tres interfaces de LECTURA de otros dominios y no tiene ninguna de
 * escritura a su alcance: la propiedad "solo lectura" de D-10 no depende de que
 * nadie llame al método equivocado, porque el método no está inyectado.
 *
 * El proveedor conversacional se elige por configuración y por defecto es el
 * simulado — no como parche, sino porque la tarifa de D-10 no está verificada
 * (H9-03) y la consulta por texto responde exactamente lo mismo.
 */
@Module({
  imports: [LecturaModule],
  controllers: [ConsultaController],
  providers: [
    ConsultaService,
    {
      provide: PROVEEDOR_AGENTE_VOZ,
      useClass: config().PROVEEDOR_AGENTE_VOZ === 'grok' ? AgenteGrok : AgenteSimulado,
    },
  ],
})
export class ConsultaModule {}
