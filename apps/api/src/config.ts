import { z } from 'zod';

/**
 * Configuración validada en el arranque. Si falta algo obligatorio, el proceso
 * no levanta: mejor fallar aquí que a mitad de un conteo.
 *
 * Principio VI: todo lo que cruza una frontera de confianza se valida en runtime,
 * y el entorno es una frontera de confianza.
 */
const EsquemaEntorno = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(32).default('desarrollo-local-secreto-de-al-menos-32-chars'),

  DATABASE_URL: z.string().default('postgres://cci:cci_local@localhost:5432/cci'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Restricción 5: toda dependencia externa tiene implementación alternativa.
  // El MVP arranca en modo simulado, sin credenciales, sin costo y sin red.
  PROVEEDOR_VOZ: z.enum(['simulado', 'deepgram']).default('simulado'),
  DEEPGRAM_API_KEY: z.string().optional(),

  PROVEEDOR_INTERPRETACION: z.enum(['simulado', 'anthropic']).default('simulado'),
  OPENROUTER_API_KEY: z.string().optional(),
  // Vacío = API de Anthropic directa. Con valor = pasarela compatible
  // (OpenRouter). Se deja configurable porque el cacheo de prompt con TTL de
  // 1 h y `effort` son nativos de Anthropic, y una pasarela puede no
  // reenviarlos — la medición decide, no la preferencia.
  BASE_URL_LLM: z.string().optional(),

  PROVEEDOR_ERP: z.enum(['simulado', 'oracle']).default('simulado'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('cci-api'),
});

export type Configuracion = z.infer<typeof EsquemaEntorno>;

let cache: Configuracion | undefined;

export function config(): Configuracion {
  if (cache) return cache;

  const resultado = EsquemaEntorno.safeParse(process.env);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${detalle}`);
  }

  // Un proveedor real sin credencial es un error de configuración, no un caso
  // a degradar en silencio: quien lo activó espera que funcione.
  const c = resultado.data;
  if (c.PROVEEDOR_VOZ === 'deepgram' && !c.DEEPGRAM_API_KEY) {
    throw new Error('PROVEEDOR_VOZ=deepgram exige DEEPGRAM_API_KEY');
  }
  if (c.PROVEEDOR_INTERPRETACION === 'anthropic' && !c.OPENROUTER_API_KEY) {
    throw new Error('PROVEEDOR_INTERPRETACION=anthropic exige OPENROUTER_API_KEY');
  }

  cache = c;
  return cache;
}
