import { Module } from '@nestjs/common';

import { DespachoModule } from './despacho/despacho.module';
import { AprendizajeModule } from './modules/aprendizaje/aprendizaje.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { CapturaModule } from './modules/captura/captura.module';
import { CatalogoModule } from './modules/catalogo/catalogo.module';
import { ConsultaModule } from './modules/consulta/consulta.module';
import { ConsolidacionModule } from './modules/consolidacion/consolidacion.module';
import { IdentidadModule } from './modules/identidad/identidad.module';
import { IntegracionModule } from './modules/integracion/integracion.module';
import { MetricasModule } from './modules/metricas/metricas.module';
import { SaludModule } from './platform/salud/salud.module';
import { PresenciaModule } from './modules/presencia/presencia.module';
import { ProveedoresModule } from './proveedores/proveedores.module';

/**
 * Monolito modular (Principio III): seis dominios con frontera verificada por el
 * compilador y por lint. Cada uno debe poder extraerse a servicio independiente
 * sin refactorizar su lógica interna.
 */
@Module({
  imports: [
    SaludModule,
    PresenciaModule,
    ProveedoresModule,
    IdentidadModule,
    CatalogoModule,
    CapturaModule,
    ConsolidacionModule,
    AuditoriaModule,
    IntegracionModule,
    AprendizajeModule,
    ConsultaModule,
    MetricasModule,
    // Arranca el despachador del outbox: sin él los eventos se escriben y
    // nadie los consume (Principio IV).
    DespachoModule,
  ],
})
export class AppModule {}
