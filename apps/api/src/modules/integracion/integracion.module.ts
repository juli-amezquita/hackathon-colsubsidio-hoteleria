import { Module } from '@nestjs/common';

import { config } from '../../config';
import { PROVEEDOR_SALIDAS } from '../../platform/dominio/estado';
import { ErpOracle } from '../../proveedores/erp/oracle';
import { PUERTO_ERP } from '../../proveedores/erp/puerto';
import { ErpSimulado } from '../../proveedores/erp/simulado';
import { IntegracionController } from './integracion.controller';
import { IntegracionService } from './integracion.service';

/**
 * Dominio `integracion` — frontera dura (Principio III).
 *
 * El adaptador del ERP se elige en el arranque y siempre hay alternativa
 * (Restricción 5). El simulado no es un maniquí: reconoce referencias
 * repetidas y responde igual, que es lo que hace honesta la prueba de que un
 * reenvío no duplica.
 */
@Module({
  controllers: [IntegracionController],
  providers: [
    IntegracionService,
    { provide: PUERTO_ERP, useClass: config().PROVEEDOR_ERP === 'oracle' ? ErpOracle : ErpSimulado },
    { provide: PROVEEDOR_SALIDAS, useExisting: IntegracionService },
  ],
  exports: [IntegracionService, PROVEEDOR_SALIDAS],
})
export class IntegracionModule {}
