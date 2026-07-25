import { randomUUID } from 'node:crypto';

import { validarEvento, type Evento } from '@cci/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';

import type { EventBus, EventoAPublicar } from './bus';

/**
 * Outbox transaccional (D-14).
 *
 * ¿Por qué no pg-boss, que era lo previsto? Porque sería redundante: **el
 * outbox YA es la cola.** Meter pg-boss obligaría a escribir dos veces —a la
 * tabla y a la cola— y esa segunda escritura queda fuera de la transacción del
 * dato, que es exactamente lo que el Principio IV prohíbe.
 *
 * La propiedad que el plan pedía es atomicidad con la causa y despacho con
 * `FOR UPDATE SKIP LOCKED`, y eso son sesenta líneas sin dependencia nueva. Si
 * algún día hace falta reintento con backoff sofisticado o consumidores fuera
 * del proceso, entra un relay detrás de la misma interfaz `EventBus` y los
 * dominios no se enteran.
 */
@Injectable()
export class OutboxBus implements EventBus {
  async publicar(trx: postgres.TransactionSql, evento: EventoAPublicar): Promise<void> {
    // El payload se valida ANTES de guardarse. Un evento mal formado que entra
    // al outbox falla después, en el consumidor, lejos de donde se arregla.
    const completo: Evento = validarEvento({
      eventId: randomUUID(),
      tipo: evento.tipo,
      version: 1,
      ocurridoEn: new Date().toISOString(),
      actorId: evento.actorId ?? null,
      payload: evento.payload,
    });

    await trx`
      INSERT INTO outbox (id, tipo_evento, version, payload, actor_id, ocurrido_en)
      VALUES (${completo.eventId}, ${completo.tipo}, ${completo.version},
              ${trx.json(completo.payload)}, ${completo.actorId}, ${completo.ocurridoEn})`;
  }
}
