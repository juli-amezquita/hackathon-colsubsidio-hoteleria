import { Module } from '@nestjs/common';

import { CatalogoModule } from '../modules/catalogo/catalogo.module';

/**
 * Raíz de composición de las interfaces publicadas entre dominios.
 *
 * Un dominio que necesita a otro inyecta su token de `platform/dominio` e
 * importa ESTE módulo, nunca el módulo del otro dominio. Parece un rodeo y no
 * lo es: es la diferencia entre depender de un contrato y depender de una
 * implementación.
 *
 * La prueba está en qué haría falta para extraer `catalogo` a un servicio
 * aparte. Con `captura` importando `CatalogoModule`, habría que tocar `captura`.
 * Con este módulo, se cambia aquí la línea que liga el token —a un cliente HTTP,
 * por ejemplo— y ningún dominio se entera. Eso es lo que el Principio III pide,
 * y por eso la regla de lint prohíbe el atajo aunque en un monolito funcione.
 *
 * ⚠️ Aquí van los dominios que OTROS DOMINIOS consumen. `captura` publica
 * `PROVEEDOR_RONDAS`, pero su único consumidor es la emisión de credencial de
 * voz, que vive en `proveedores/` — otra pieza de la raíz de composición, no un
 * dominio. Meterlo aquí crearía un ciclo, porque `captura` importa este módulo
 * para consumir `catalogo`.
 */
/**
 * Se re-exporta el MÓDULO y no el token: Nest solo deja exportar un proveedor
 * al módulo que lo declara. No debilita nada — `CatalogoModule` exporta
 * únicamente `PROVEEDOR_CATALOGO`, así que lo que llega a quien importe esto
 * sigue siendo la interfaz publicada y nada más.
 */
@Module({
  imports: [CatalogoModule],
  exports: [CatalogoModule],
})
export class DominiosModule {}
