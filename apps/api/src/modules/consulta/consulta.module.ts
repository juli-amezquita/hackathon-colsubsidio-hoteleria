import { Module } from '@nestjs/common';

import { LecturaModule } from '../../composicion/lectura.module';
import { config } from '../../config';
import { AgenteGeminiLive } from '../../proveedores/agente-voz/gemini';
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
/**
 * El adaptador conversacional, elegido en el arranque.
 *
 * `gemini` es el único con endpoint y tarifa verificados contra la API real
 * —Grok viene del brief— pero los tres pasan por la misma puerta: si el
 * proveedor no está `verificado`, el controlador se niega a emitir credencial
 * y ofrece la consulta por texto, que responde exactamente lo mismo.
 */
function elegirAgente() {
  switch (config().PROVEEDOR_AGENTE_VOZ) {
    case 'gemini':
      return AgenteGeminiLive;
    case 'grok':
      return AgenteGrok;
    default:
      return AgenteSimulado;
  }
}

@Module({
  imports: [LecturaModule],
  controllers: [ConsultaController],
  providers: [
    ConsultaService,
    {
      provide: PROVEEDOR_AGENTE_VOZ,
      useClass: elegirAgente(),
    },
  ],
})
export class ConsultaModule {}
