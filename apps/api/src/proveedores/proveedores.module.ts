import { Module } from '@nestjs/common';

import { DominiosModule } from '../composicion/dominios.module';
import { CapturaModule } from '../modules/captura/captura.module';
import { config } from '../config';
import { InterpretacionAnthropic } from './interpretacion/anthropic';
import { PROVEEDOR_INTERPRETACION } from './interpretacion/proveedor';
import { InterpretacionSimulada } from './interpretacion/simulado';
import { DeepgramVoz } from './voz/deepgram';
import { PROVEEDOR_VOZ } from './voz/proveedor';
import { VozSimulada } from './voz/simulado';
import { VozController } from './voz/voz.controller';
import { PuenteDeVoz } from './agente-voz/puente-voz';
import { CatalogoModule } from '../modules/catalogo/catalogo.module';
import { IdentidadModule } from '../modules/identidad/identidad.module';

/**
 * Proveedores externos, todos detrás de interfaz con alternativa (Restricción 5).
 *
 * La elección es por configuración y en el arranque, no un `if` en la ruta
 * caliente: así el modo simulado es indistinguible del real desde el dominio,
 * y conmutar de proveedor no exige tocar una línea de negocio.
 */
@Module({
  imports: [DominiosModule, CapturaModule, CatalogoModule, IdentidadModule],
  controllers: [VozController],
  providers: [
    {
      provide: PROVEEDOR_VOZ,
      useClass: config().PROVEEDOR_VOZ === 'deepgram' ? DeepgramVoz : VozSimulada,
    },
    {
      provide: PROVEEDOR_INTERPRETACION,
      useClass:
        config().PROVEEDOR_INTERPRETACION === 'anthropic'
          ? InterpretacionAnthropic
          : InterpretacionSimulada,
    },
    PuenteDeVoz,
  ],
  exports: [PROVEEDOR_VOZ, PROVEEDOR_INTERPRETACION, PuenteDeVoz],
})
export class ProveedoresModule {}
