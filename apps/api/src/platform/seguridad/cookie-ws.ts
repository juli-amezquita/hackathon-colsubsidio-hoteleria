/**
 * La cookie de sesión, sacada a mano del encabezado.
 *
 * Un WebSocket no pasa por Fastify ni por sus plugins, así que `req.cookies` no
 * existe en el `upgrade`. Vive aquí, en un solo sitio, porque lo usan el puente
 * de voz y el de presencia: dos copias de un parseo de cookies es como una de
 * las dos acaba aceptando algo que la otra rechaza.
 */
export function cookieDeSesion(
  encabezado: string | undefined,
  nombre: string,
): string | undefined {
  if (!encabezado) return undefined;
  for (const trozo of encabezado.split(';')) {
    const i = trozo.indexOf('=');
    if (i === -1) continue;
    if (trozo.slice(0, i).trim() === nombre) return decodeURIComponent(trozo.slice(i + 1).trim());
  }
  return undefined;
}
