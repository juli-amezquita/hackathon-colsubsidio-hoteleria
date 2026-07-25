/**
 * F-17 · Redacción de logs (NFR-005, Principio V, Ley 1581).
 *
 * PROHIBIDO registrar credenciales, tokens, audio crudo de operarios y datos
 * personales identificables. No es una recomendación: es lo que hace que un
 * volcado de logs no sea una fuga de datos personales.
 *
 * La lista es por NOMBRE DE CAMPO en vez de por detección de contenido, porque
 * detectar "esto parece una contraseña" falla justo cuando importa.
 */

const PROHIBIDOS = [
  'password',
  'contrasena',
  'contraseña',
  'clave',
  'hash_password',
  'hashpassword',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'session_secret',
  'sessionsecret',
  'apikey',
  'api_key',
  'secret',
  'audio',
  'clip',
  'documento',
  'cedula',
  'cédula',
];

const OCULTO = '[redactado]';

function esProhibido(clave: string): boolean {
  const k = clave.toLowerCase();
  return PROHIBIDOS.some((p) => k.includes(p));
}

/**
 * Devuelve una copia segura para registrar. Nunca muta el original: un log no
 * puede tener efectos sobre el dato que está describiendo.
 */
export function redactar(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 6) return '[profundidad máxima]';
  if (valor === null || typeof valor !== 'object') return valor;

  if (Array.isArray(valor)) return valor.map((v) => redactar(v, profundidad + 1));

  // Un Buffer en un log es audio, una imagen o una clave. Nunca es útil.
  if (Buffer.isBuffer(valor)) return `[buffer ${valor.length} bytes]`;

  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    salida[k] = esProhibido(k) ? OCULTO : redactar(v, profundidad + 1);
  }
  return salida;
}

/**
 * Configuración de redacción para el logger de Fastify (pino), que registra
 * cada petición. Es donde de verdad se filtrarían las cookies de sesión.
 */
export const REDACCION_PINO = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'req.body.password',
    'req.body.usuario',
    '*.password',
    '*.hash_password',
    '*.claveIdempotencia',
  ],
  censor: OCULTO,
};
