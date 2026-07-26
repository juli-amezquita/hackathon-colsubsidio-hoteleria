import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

import { config } from '../../config';
import { conexion } from '../../platform/db/cliente';
import { redis } from '../../platform/redis/cliente';

/**
 * Quién está contando en cada bodega, ahora mismo.
 *
 * ## Qué problema resuelve y cuál NO
 *
 * Dos operarios contando la misma bodega **no es un fallo, es el mecanismo**:
 * una ronda es el recorrido de UNA persona, las rondas no se pisan y se
 * acumulan, y D5 apoya la conciliación justamente en que los conteos sean
 * independientes. Bloquear al segundo destruiría eso.
 *
 * Lo que sí faltaba es que nadie supiera nada del otro. El equipo descubría que
 * dos personas habían recorrido el mismo estante cuando ya estaba hecho.
 *
 * Así que esto **avisa y no impide**. Y avisa con cuidado: dice *cuántos* están
 * contando y *quiénes*, nunca **qué** han contado. Decir "Juan ya registró 30
 * panes" contaminaría el conteo del que llega, que es exactamente lo que la
 * ceguera existe para evitar (FR-1.18, D5).
 *
 * ## Por qué Redis y no un `Map` en el proceso
 *
 * Con una sola instancia un `Map` bastaría, y sería mentira: el despliegue es
 * un reemplazo sin draining, así que durante unos segundos hay dos procesos
 * vivos y cada uno vería la mitad de la gente. Redis lo comparte y además
 * caduca solo — si un dispositivo se queda sin batería en mitad del pasillo,
 * su presencia se va sin que nadie tenga que limpiarla.
 */

/** Si un dispositivo no da señal en este tiempo, deja de contar como presente. */
const VIDA_SEGUNDOS = 45;

/** Canal de avisos: al cambiar algo, todas las réplicas reenvían a sus clientes. */
const CANAL = 'presencia:cambio';

const clave = (bodegaId: string): string => `presencia:${bodegaId}`;

export interface Presente {
  readonly usuarioId: string;
  readonly nombre: string;
  /** Desde cuándo está en la bodega, en ISO. Para decir "lleva 20 minutos". */
  readonly desde: string;
}

export interface EstadoBodega {
  readonly bodegaId: string;
  readonly presentes: readonly Presente[];
  /** Rondas ya cerradas. Es el historial de conteos de esa bodega. */
  readonly rondasCerradas: number;
  /** Rondas abiertas, incluidas las de gente que hoy no está conectada. */
  readonly rondasAbiertas: number;
}

@Injectable()
export class PresenciaService implements OnApplicationShutdown {
  /** Conexión aparte: un cliente suscrito no puede ejecutar otros comandos. */
  private suscriptor: Redis | undefined;
  private readonly oyentes = new Set<() => void>();

  /**
   * Marca que este usuario sigue en esa bodega.
   *
   * Se llama al entrar y se repite mientras dure la sesión. Refrescar en vez de
   * mantener una conexión abierta significa que un navegador cerrado de golpe
   * —lo normal en un móvil— desaparece solo en menos de un minuto.
   */
  async entrar(bodegaId: string, usuarioId: string, nombre: string): Promise<void> {
    const r = redis();
    const yaEstaba = await r.hget(clave(bodegaId), usuarioId);
    const desde = yaEstaba ? (JSON.parse(yaEstaba) as Presente).desde : new Date().toISOString();

    await r.hset(clave(bodegaId), usuarioId, JSON.stringify({ usuarioId, nombre, desde }));
    await r.expire(clave(bodegaId), VIDA_SEGUNDOS);

    // Solo se avisa cuando alguien LLEGA. Refrescar no cambia nada para nadie y
    // avisarlo cada quince segundos por operario llenaría el canal de ruido.
    if (!yaEstaba) await r.publish(CANAL, bodegaId);
  }

  async salir(bodegaId: string, usuarioId: string): Promise<void> {
    const r = redis();
    const borrados = await r.hdel(clave(bodegaId), usuarioId);
    if (borrados > 0) await r.publish(CANAL, bodegaId);
  }

  /**
   * El estado de las bodegas que este usuario puede ver.
   *
   * Presencia de Redis y conteo de rondas de Postgres, en una sola consulta:
   * el historial —"esta bodega lleva 3 conteos"— es lo que convierte el aviso
   * en información útil. Saber que hay alguien contando dice poco; saber que la
   * bodega ya tuvo tres rondas dice si vale la pena hacer una cuarta.
   */
  async estado(bodegaIds: readonly string[]): Promise<EstadoBodega[]> {
    if (bodegaIds.length === 0) return [];

    const r = redis();
    const presencias = await Promise.all(
      bodegaIds.map((id) =>
        r
          .hgetall(clave(id))
          .then((h) => Object.values(h).map((v) => JSON.parse(v) as Presente))
          // Si Redis se cae, se responde sin presencia en vez de no responder:
          // el aviso es una comodidad, contar es el trabajo (Restricción 5).
          .catch(() => [] as Presente[]),
      ),
    );

    const filas = await conexion()<{ bodega_id: string; cerradas: number; abiertas: number }[]>`
      SELECT r.bodega_id,
             count(*) FILTER (WHERE rc.ronda_id IS NOT NULL)::int AS cerradas,
             count(*) FILTER (WHERE rc.ronda_id IS NULL)    ::int AS abiertas
      FROM ronda r
      -- El cierre no es una columna de \`ronda\`: es una fila en \`ronda_cierre\`,
      -- y su existencia ES el estado cerrado. Contar por el LEFT JOIN respeta
      -- esa decisión en vez de inventar una bandera paralela.
      LEFT JOIN ronda_cierre rc ON rc.ronda_id = r.id
      WHERE r.bodega_id = ANY(${bodegaIds as string[]})
      GROUP BY r.bodega_id`;

    const porBodega = new Map(filas.map((f) => [f.bodega_id, f]));

    return bodegaIds.map((bodegaId, i) => ({
      bodegaId,
      presentes: presencias[i] ?? [],
      rondasCerradas: porBodega.get(bodegaId)?.cerradas ?? 0,
      rondasAbiertas: porBodega.get(bodegaId)?.abiertas ?? 0,
    }));
  }

  /**
   * Avisa cuando algo cambia, en CUALQUIER réplica.
   *
   * Sin el pub/sub, un operario conectado a la réplica A no vería llegar a uno
   * que entró por la B — y una vista "en vivo" que depende de a qué servidor te
   * tocó es peor que no tenerla, porque parece que funciona.
   */
  alCambiar(oyente: () => void): () => void {
    this.oyentes.add(oyente);

    if (!this.suscriptor) {
      this.suscriptor = new Redis(config().REDIS_URL, { maxRetriesPerRequest: 2 });
      this.suscriptor.on('error', () => {
        /* sin avisos en vivo se sigue trabajando: el sondeo del cliente cubre */
      });
      void this.suscriptor.subscribe(CANAL);
      this.suscriptor.on('message', () => {
        for (const o of this.oyentes) o();
      });
    }

    return () => this.oyentes.delete(oyente);
  }

  onApplicationShutdown(): void {
    void this.suscriptor?.quit();
    this.suscriptor = undefined;
    this.oyentes.clear();
  }
}
