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
  /** El árbitro que ordena la evidencia del caso (H4-05). Nunca decide. */
  PROVEEDOR_ARBITRAJE: z.enum(['determinista', 'anthropic']).default('determinista'),
  OPENROUTER_API_KEY: z.string().optional(),
  // Vacío = API de Anthropic directa. Con valor = pasarela compatible
  // (OpenRouter). Se deja configurable porque el cacheo de prompt con TTL de
  // 1 h y `effort` son nativos de Anthropic, y una pasarela puede no
  // reenviarlos — la medición decide, no la preferencia.
  BASE_URL_LLM: z.string().optional(),

  PROVEEDOR_ERP: z.enum(['simulado', 'oracle']).default('simulado'),
  /** Agente conversacional del supervisor (D-10). Ver H9-03 antes de encenderlo. */
  PROVEEDOR_AGENTE_VOZ: z.enum(['simulado', 'grok', 'gemini']).default('simulado'),
  XAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** Oracle Fusion Cloud Inventory Management (SPEC §6). Sin verificar. */
  ERP_BASE_URL: z.string().url().optional(),
  ERP_USUARIO: z.string().optional(),
  ERP_PASSWORD: z.string().optional(),

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
  exigirCredencial(c.PROVEEDOR_VOZ === 'deepgram', 'PROVEEDOR_VOZ=deepgram', 'DEEPGRAM_API_KEY', c.DEEPGRAM_API_KEY);
  exigirCredencial(c.PROVEEDOR_ARBITRAJE === 'anthropic', 'PROVEEDOR_ARBITRAJE=anthropic', 'OPENROUTER_API_KEY', c.OPENROUTER_API_KEY);
  exigirCredencial(c.PROVEEDOR_INTERPRETACION === 'anthropic', 'PROVEEDOR_INTERPRETACION=anthropic', 'OPENROUTER_API_KEY', c.OPENROUTER_API_KEY);
  exigirCredencial(c.PROVEEDOR_AGENTE_VOZ === 'gemini', 'PROVEEDOR_AGENTE_VOZ=gemini', 'GEMINI_API_KEY', c.GEMINI_API_KEY);
  exigirCredencial(c.PROVEEDOR_AGENTE_VOZ === 'grok', 'PROVEEDOR_AGENTE_VOZ=grok', 'XAI_API_KEY', c.XAI_API_KEY);
  exigirCredencial(c.PROVEEDOR_ERP === 'oracle', 'PROVEEDOR_ERP=oracle', 'ERP_BASE_URL', c.ERP_BASE_URL);
  exigirCredencial(c.PROVEEDOR_ERP === 'oracle', 'PROVEEDOR_ERP=oracle', 'ERP_USUARIO', c.ERP_USUARIO);
  exigirCredencial(c.PROVEEDOR_ERP === 'oracle', 'PROVEEDOR_ERP=oracle', 'ERP_PASSWORD', c.ERP_PASSWORD);

  cache = c;
  return cache;
}

/**
 * El marcador de «pendiente» NO es una credencial.
 *
 * Terraform crea cada parámetro de proveedor con el texto
 * `PENDIENTE-cargar-con-aws-ssm-put-parameter` para que exista sin poner un
 * secreto en el estado. La comprobación anterior era `!c.CLAVE`, y ese texto
 * es una cadena no vacía: pasaba.
 *
 * El efecto era el peor de los dos posibles. Quien encendiera
 * `PROVEEDOR_ARBITRAJE=anthropic` creyendo que ya estaba configurado veía la
 * API arrancar sin una queja, y luego **cada llamada al árbitro fallaba en
 * caliente**: el Auditor recibía una síntesis vacía etiquetada como `anthropic`,
 * sin saber que no había modelo detrás. Una guarda que no guarda es peor que no
 * tenerla, porque se confía en ella.
 */
function exigirCredencial(activo: boolean, proveedor: string, nombre: string, valor: string | undefined): void {
  if (!activo) return;

  if (!valor?.trim()) {
    throw new Error(`${proveedor} exige ${nombre}, y no está definida.`);
  }
  if (/^PENDIENTE/i.test(valor.trim())) {
    throw new Error(
      `${proveedor} exige ${nombre}, y su valor sigue siendo el marcador de Terraform. ` +
        `Cárgala de verdad:  aws ssm put-parameter --name /cci/mvp/${nombre} --type SecureString --value '…' --overwrite`,
    );
  }
}
