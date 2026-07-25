import { validarEvento, type Evento } from '@cci/contracts';
import type postgres from 'postgres';

import type { Consumidor } from './bus';

/**
 * Despachador del outbox (F-10, F-11).
 *
 * Toma eventos pendientes con `FOR UPDATE SKIP LOCKED` —para que varias
 * réplicas puedan despachar a la vez sin pisarse— y los entrega a cada
 * consumidor interesado.
 *
 * Dos garantías, y la segunda es la que importa:
 *
 *   · **At-least-once.** Si algo falla, el evento NO se marca como despachado y
 *     vuelve en la siguiente pasada. Perder un evento sería perder una
 *     discrepancia sin que nadie se entere.
 *   · **Efecto exactamente una vez.** Cada consumidor registra
 *     `(consumidor, event_id)` EN LA MISMA TRANSACCIÓN que su efecto. Recibirlo
 *     dos veces produce un solo efecto, porque la segunda vez choca con la
 *     clave primaria y la transacción entera se descarta.
 *
 * At-least-once + deduplicación = efectivamente una vez. Es el patrón de Stripe.
 */
export class DespachadorOutbox {
  private corriendo = false;
  private temporizador: NodeJS.Timeout | undefined;

  constructor(
    private readonly sql: postgres.Sql,
    private readonly consumidores: readonly Consumidor[],
    private readonly intervaloMs = 1000,
    private readonly lote = 50,
  ) {}

  iniciar(): void {
    if (this.temporizador) return;
    this.temporizador = setInterval(() => void this.pasada(), this.intervaloMs);
    this.temporizador.unref();
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = undefined;
  }

  /** Una pasada. Devuelve cuántos eventos despachó. Público para poder probarlo. */
  async pasada(): Promise<number> {
    if (this.corriendo) return 0; // sin solapamiento dentro del mismo proceso
    this.corriendo = true;

    try {
      return await this.sql.begin(async (trx) => {
        const filas = await trx<
          { id: string; tipo_evento: string; version: number; payload: unknown; actor_id: string | null; ocurrido_en: Date }[]
        >`
          SELECT id, tipo_evento, version, payload, actor_id, ocurrido_en
          FROM outbox
          WHERE despachado_en IS NULL
          ORDER BY ocurrido_en
          LIMIT ${this.lote}
          FOR UPDATE SKIP LOCKED`;

        let n = 0;

        for (const f of filas) {
          const evento: Evento = validarEvento({
            eventId: f.id,
            tipo: f.tipo_evento,
            version: f.version,
            ocurridoEn: f.ocurrido_en.toISOString(),
            actorId: f.actor_id,
            payload: f.payload,
          });

          for (const c of this.consumidores) {
            if (!c.interesadoEn.includes(evento.tipo)) continue;
            await this.entregar(trx, c, evento);
          }

          await trx`UPDATE outbox SET despachado_en = now() WHERE id = ${f.id}`;
          n += 1;
        }

        return n;
      });
    } finally {
      this.corriendo = false;
    }
  }

  /**
   * La marca de procesado va PRIMERO y en la misma transacción que el efecto.
   * Si el evento ya se procesó, el INSERT no inserta nada y el consumidor no se
   * ejecuta: ahí está la idempotencia, en una restricción de la base y no en un
   * `if` que alguien pueda quitar.
   */
  private async entregar(
    trx: postgres.TransactionSql,
    consumidor: Consumidor,
    evento: Evento,
  ): Promise<void> {
    const marca = await trx`
      INSERT INTO evento_procesado (consumidor, event_id)
      VALUES (${consumidor.nombre}, ${evento.eventId})
      ON CONFLICT (consumidor, event_id) DO NOTHING
      RETURNING event_id`;

    if (marca.length === 0) return; // ya procesado: no se repite el efecto

    await consumidor.manejar(trx, evento);
  }
}
