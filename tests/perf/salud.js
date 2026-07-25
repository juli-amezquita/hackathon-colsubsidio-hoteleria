import http from 'k6/http';
import { check } from 'k6';

/**
 * k6 — línea base de rendimiento (E9, Principio VII).
 *
 * El objetivo real del sistema es p95 < 200 ms con 500 concurrentes. El pico de
 * API son ~35 req/s, no 500 rps: cada operario escribe una vez cada ~15 s y el
 * audio no pasa por aquí (D-07-A).
 *
 * En la Fase 1 esto solo mide `/salud`. El escenario de conteo llega en C-02.
 *
 *   k6 run tests/perf/salud.js
 */
export const options = {
  scenarios: {
    ventana_de_conteo: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Una regresión aquí falla la build.
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.API_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE}/salud`);
  check(res, {
    'responde 200': (r) => r.status === 200,
    'trae estado': (r) => typeof r.json('estado') === 'string',
  });
}
