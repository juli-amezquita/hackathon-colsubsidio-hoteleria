import { Module } from '@nestjs/common';

/**
 * Dominio `auditoria` — frontera dura (Principio III).
 *
 * Ningún otro módulo puede importar rutas internas de este ni tocar sus tablas.
 * La comunicación es por interfaz publicada (`platform/dominio`) o por evento.
 * La regla de lint `no-restricted-imports` lo verifica en cada build (S-09).
 *
 * Vacío en la Fase 1: el andamiaje existe, la lógica llega en su slice.
 */
@Module({})
export class AuditoriaModule {}
