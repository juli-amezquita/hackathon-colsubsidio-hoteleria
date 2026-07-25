import { Module } from '@nestjs/common';

import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { CapturaModule } from './modules/captura/captura.module';
import { CatalogoModule } from './modules/catalogo/catalogo.module';
import { ConsolidacionModule } from './modules/consolidacion/consolidacion.module';
import { IdentidadModule } from './modules/identidad/identidad.module';
import { IntegracionModule } from './modules/integracion/integracion.module';
import { SaludModule } from './platform/salud/salud.module';
import { ProveedoresModule } from './proveedores/proveedores.module';

/**
 * Monolito modular (Principio III): seis dominios con frontera verificada por el
 * compilador y por lint. Cada uno debe poder extraerse a servicio independiente
 * sin refactorizar su lógica interna.
 */
@Module({
  imports: [
    SaludModule,
    ProveedoresModule,
    IdentidadModule,
    CatalogoModule,
    CapturaModule,
    ConsolidacionModule,
    AuditoriaModule,
    IntegracionModule,
  ],
})
export class AppModule {}
