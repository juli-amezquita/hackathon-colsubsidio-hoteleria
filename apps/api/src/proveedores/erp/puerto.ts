/**
 * H7-03 · `PuertoInventarioERP` — la frontera con el sistema central.
 *
 * El sistema central es Oracle Fusion Cloud Inventory Management (SPEC §6), y
 * su disponibilidad es una dependencia externa que este proyecto no controla.
 * Por eso el contrato está escrito para que el adaptador SIMULADO sea
 * suficiente para demostrar el sistema entero: si la integración real llega
 * tarde, el inventario se cierra igual y el consolidado se descarga igual.
 *
 * Dos cosas que este puerto deja fijas:
 *
 * 1. **La referencia la pone el llamador, no el ERP.** Es lo que hace seguro
 *    reintentar un envío cuyo resultado se desconoce (FR-7.4): el ERP puede
 *    haberlo recibido y haberse caído antes de responder, y sin una referencia
 *    estable el reintento duplicaría los movimientos.
 *
 * 2. **Un envío parcial se reporta como parcial.** Nunca como completo. El
 *    edge case existe porque un ERP puede aceptar 40 líneas de 55 y devolver
 *    un 200: darlo por bueno perdería quince artículos en silencio.
 */

export interface LineaInventario {
  readonly articuloId: string;
  readonly codigo: string | null;
  readonly nombre: string;
  readonly cantidad: string;
  readonly unidad: string;
  /** Conciliado por conteo ciego o resuelto por el Auditor (FR-7.7). */
  readonly origen: string;
  readonly codigoRazon: string | null;
}

export interface EnvioInventario {
  readonly referencia: string;
  readonly bodegaCodigo: string;
  readonly lineas: readonly LineaInventario[];
}

export interface ResultadoEnvio {
  readonly estado: 'aceptado' | 'parcial' | 'fallido';
  readonly aceptadas: number;
  /** Qué rechazó y por qué. Va a la constancia, no a un log que nadie lee. */
  readonly rechazos: readonly { articuloId: string; motivo: string }[];
  readonly respuestaCruda: unknown;
}

export interface PuertoInventarioERP {
  readonly nombre: string;
  enviar(envio: EnvioInventario): Promise<ResultadoEnvio>;
}

export const PUERTO_ERP = Symbol('PuertoInventarioERP');
