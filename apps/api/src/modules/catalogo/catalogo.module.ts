import { Module } from '@nestjs/common';

import { Cache } from '../../platform/cache/cache';
import { PROVEEDOR_CATALOGO } from '../../platform/dominio/catalogo';
import { ResolucionService } from './resolucion.service';

/**
 * Dominio `catalogo` — frontera dura (Principio III).
 *
 * Exporta solo `PROVEEDOR_CATALOGO`. `ResolucionService`, su SQL y sus
 * umbrales son internos: `captura` no puede importarlos y la regla de lint lo
 * verifica.
 */
@Module({
  providers: [Cache, ResolucionService, { provide: PROVEEDOR_CATALOGO, useExisting: ResolucionService }],
  exports: [PROVEEDOR_CATALOGO],
})
export class CatalogoModule {}
