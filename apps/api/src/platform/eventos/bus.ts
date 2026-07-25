import type { Evento, TipoEvento } from '@cci/contracts';
import type postgres from 'postgres';

/**
 * F-10 · Bus de eventos detrás de una interfaz (Principio IV, D-14).
 *
 * `publicar` EXIGE la transacción como parámetro. No es un detalle de estilo:
 * es lo que hace imposible emitir un evento fuera de la transacción que
 * persiste su causa. Si la firma permitiera omitirla, alguien la omitiría, y el
 * día que fallara nadie se enteraría — el dato quedaría guardado y el evento
 * perdido, sin ningún error.
 *
 * El transporte del MVP es la tabla `outbox` in-process. Reemplazarlo por un bus
 * externo no puede exigir cambios en los dominios: por eso esta interfaz existe.
 */
export interface EventBus {
  publicar(trx: postgres.TransactionSql, evento: EventoAPublicar): Promise<void>;
}

/** Lo que un dominio emite. El sobre lo completa el bus. */
export interface EventoAPublicar<T extends TipoEvento = TipoEvento> {
  readonly tipo: T;
  readonly payload: Evento<T>['payload'];
  readonly actorId?: string | null;
}

export const EVENT_BUS = Symbol('EventBus');

/** Un consumidor de eventos de dominio. */
export interface Consumidor {
  /** Identifica al consumidor en `evento_procesado`. Debe ser estable. */
  readonly nombre: string;
  readonly interesadoEn: readonly TipoEvento[];
  manejar(trx: postgres.TransactionSql, evento: Evento): Promise<void>;
}
