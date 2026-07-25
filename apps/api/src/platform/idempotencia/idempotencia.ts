import type postgres from 'postgres';

/**
 * F-19 · Idempotencia del lado del servidor (Restricción 2, FR-6.2).
 *
 * La garantía que hay que dar es doble y va en direcciones opuestas:
 * *ningún dato confirmado al usuario puede perderse por una falla de red*, y
 * *ningún reintento puede duplicarlo*.
 *
 * La primera mitad la resuelve el cliente escribiendo antes de enviar. Esta es
 * la segunda: la clave la genera el DISPOSITIVO, no el servidor, porque el
 * servidor no puede distinguir "me lo mandaron dos veces" de "lo mandaron dos
 * veces a propósito" si no viene marcado desde el origen.
 *
 * `ON CONFLICT DO NOTHING` sobre una restricción UNIQUE hace los reintentos
 * seguros POR CONSTRUCCIÓN: no hay ventana entre comprobar y escribir, porque
 * no se comprueba — se intenta, y la base decide.
 *
 * at-least-once + deduplicación = efectivamente una vez.
 */

export interface ResultadoIdempotente<T> {
  readonly valor: T;
  /** `true` si esta llamada creó el registro; `false` si ya existía. */
  readonly creado: boolean;
}

/**
 * Ejecuta `insertar` y, si la clave ya existía, devuelve lo que se guardó
 * la primera vez en vez de fallar.
 *
 * El reintento debe ver EXACTAMENTE la misma respuesta que el envío original.
 * Devolver un error al reintento sería tan malo como duplicar: el cliente
 * volvería a intentarlo para siempre.
 */
export async function insertarIdempotente<T>(
  trx: postgres.TransactionSql,
  opciones: {
    readonly tabla: string;
    readonly clave: string;
    /** Inserta y devuelve la fila. Debe llevar `ON CONFLICT … DO NOTHING`. */
    readonly insertar: (trx: postgres.TransactionSql) => Promise<T | undefined>;
    /** Recupera lo ya guardado cuando la clave chocó. */
    readonly recuperar: (trx: postgres.TransactionSql) => Promise<T | undefined>;
  },
): Promise<ResultadoIdempotente<T>> {
  // Ambos callbacks reciben la MISMA transacción, y la firma no deja usar otra.
  //
  // No es comodidad: con N reintentos simultáneos, Postgres bloquea a los N-1
  // hasta que el primero confirme. Si `recuperar` pidiera una conexión nueva del
  // pool, esas N-1 transacciones bloqueadas estarían ocupando el pool entero
  // esperando conexiones que nunca se liberan. Es un interbloqueo, y aparece
  // solo bajo concurrencia real — justo cuando vuelve la red y la cola del
  // dispositivo se vacía de golpe.
  const insertado = await opciones.insertar(trx);
  if (insertado !== undefined) return { valor: insertado, creado: true };

  const existente = await opciones.recuperar(trx);
  if (existente !== undefined) return { valor: existente, creado: false };

  // Ni insertó ni existe: la restricción que chocó no es la de idempotencia.
  // Fallar ruidosamente — tragarse esto escondería una violación real.
  throw new Error(
    `Conflicto en ${opciones.tabla} con clave ${opciones.clave} que no corresponde a un reintento.`,
  );
}

/**
 * Desfase entre el reloj del dispositivo y el del servidor (D-16).
 *
 * Se mide al abrir la ronda y se guarda con ella. No sirve para corregir nada:
 * sirve para que, si un dispositivo venía desajustado, la traza lo diga en vez
 * de que alguien lo descubra tres meses después mirando timestamps imposibles.
 */
export function desfaseReloj(epochCliente: number, epochServidor: number): number {
  return Math.trunc(epochCliente - epochServidor);
}
