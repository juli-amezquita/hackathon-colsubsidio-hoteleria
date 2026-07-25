import { Module } from '@nestjs/common';

import { ConsolidacionController } from './consolidacion.controller';
import { ConsolidacionService } from './consolidacion.service';

/**
 * Dominio `consolidacion` — frontera dura (Principio III).
 *
 * Ningún otro módulo puede importar rutas internas de este ni tocar sus tablas.
 * La comunicación es por interfaz publicada (`platform/dominio`) o por evento.
 * La regla de lint `no-restricted-imports` lo verifica en cada build (S-09).
 *
 * Fíjate en que NO importa `captura` para enterarse de que una ronda cerró: se
 * entera por el outbox. Los dos dominios podrían vivir en procesos distintos
 * sin cambiar una línea, que es la prueba de que la frontera es real.
 */
@Module({
  controllers: [ConsolidacionController],
  providers: [ConsolidacionService],
  exports: [ConsolidacionService],
})
export class ConsolidacionModule {}
