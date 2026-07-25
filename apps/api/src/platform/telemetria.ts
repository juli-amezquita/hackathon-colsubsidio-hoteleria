import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { config } from '../config';

/**
 * Observabilidad con latencia POR ETAPA (D-23, Principio VII).
 *
 * Un número agregado dice que algo se puso lento; no dice qué. Con un presupuesto
 * de 1.500 ms repartido entre siete etapas, sin atribución no hay diagnóstico.
 *
 * PROHIBIDO registrar audio, credenciales o datos personales (NFR-005, Ley 1581).
 */

let sdk: NodeSDK | undefined;

export function iniciarTelemetria(): void {
  const c = config();
  if (!c.OTEL_EXPORTER_OTLP_ENDPOINT) return; // sin colector configurado, no-op

  sdk = new NodeSDK({
    serviceName: c.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: `${c.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ruido puro en un servicio HTTP.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function detenerTelemetria(): Promise<void> {
  await sdk?.shutdown();
}

/** Etapas del ciclo de captura. Cada una emite su latencia por separado (D-23). */
export const ETAPAS = [
  'fin_de_turno',
  'transcripcion',
  'gramatica',
  'resolucion_nombre',
  'escritura_local',
  'readback',
  'envio',
  'validacion_servidor',
] as const;

export type Etapa = (typeof ETAPAS)[number];
