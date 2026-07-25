import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * F-33 · Carga con 500 concurrentes (E9, Principio VII).
 *
 * El objetivo NO es 500 peticiones por segundo. Son 500 operarios contando a la
 * vez, y cada uno genera una escritura cada ~15 s: el pico real de la API son
 * ~35 req/s. La concurrencia alta con caudal bajo es un perfil distinto —
 * estresa conexiones y memoria, no CPU — y es el que hay que probar.
 *
 * El audio no pasa por aquí: el navegador habla directo con el proveedor de
 * transcripción (D-07-A). Por eso la API aguanta 500 operarios en una
 * instancia pequeña.
 *
 *   k6 run tests/perf/conteo.js
 *   k6 run -e API_URL=https://... tests/perf/conteo.js
 */

const BASE = __ENV.API_URL || 'http://localhost:3000';

/**
 * Cada VU es un dispositivo distinto, y tiene que parecerlo.
 *
 * El límite de tasa son 300 peticiones por minuto **por IP**, y la API confía
 * en `X-Forwarded-For` porque CloudFront va delante. Sin esta cabecera, los 500
 * VUs comparten un solo cupo, la API responde 429 —correctamente— y la prueba
 * mide el limitador en vez del sistema.
 *
 * No es un truco para esquivar el límite: es reproducir la topología real, en
 * la que 500 operarios llegan desde 500 dispositivos.
 */
const ipDelVu = () => `10.${Math.floor(__VU / 250) % 250}.${__VU % 250}.1`;
const USUARIO = __ENV.USUARIO || '1000000001';
const CLAVE = __ENV.CLAVE || 'Inventario2026*';

const loginMs = new Trend('cci_login_ms');
const saludMs = new Trend('cci_salud_ms');

export const options = {
  scenarios: {
    /**
     * Ventana de conteo: la subida es gradual porque en la realidad los
     * operarios entran a lo largo de varios minutos, no de golpe. Un escalón
     * instantáneo mediría el arranque en frío, no la operación.
     */
    ventana_de_conteo: {
      executor: 'ramping-vus',
      startVUs: 0,
      // El perfil completo son 7 minutos y es el que se corre a mano contra
      // producción antes de entregar. En CI se usa el corto: verifica que la
      // prueba EXISTE, que arranca y que los umbrales se cumplen, sin gastar
      // siete minutos en cada push.
      stages: __ENV.PERFIL === 'ci'
        ? [
            { duration: '15s', target: 50 },
            { duration: '30s', target: 100 },
            { duration: '15s', target: 0 },
          ]
        : [
            { duration: '1m', target: 100 },
            { duration: '2m', target: 500 },
            { duration: '3m', target: 500 },
            { duration: '1m', target: 0 },
          ],
      gracefulRampDown: '30s',
    },
  },

  /**
   * Umbrales que FALLAN LA BUILD. No generan un ticket.
   *
   * `abortOnFail` corta la prueba en cuanto se incumple: seguir cargando un
   * sistema que ya falló no aporta información y cuesta minutos de CI.
   */
  thresholds: {
    'http_req_duration{tipo:lectura}': [{ threshold: 'p(95)<200', abortOnFail: true }],
    // El login hashea con argon2id a propósito: es caro por diseño (Principio V).
    'http_req_duration{tipo:login}': ['p(95)<1500'],
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true }],
  },
};

export function setup() {
  const r = http.post(
    `${BASE}/sesion`,
    JSON.stringify({ usuario: USUARIO, password: CLAVE }),
    {
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
      tags: { tipo: 'login' },
    },
  );

  if (r.status !== 200) {
    throw new Error(`No se pudo iniciar sesión para la prueba (HTTP ${r.status}).`);
  }

  loginMs.add(r.timings.duration);
  const cookie = String(r.headers['Set-Cookie'] || '').split(';')[0];
  return { cookie };
}

export default function (datos) {
  const ip = ipDelVu();
  const conSesion = {
    headers: { cookie: datos.cookie, 'x-forwarded-for': ip },
    tags: { tipo: 'lectura' },
  };

  group('sonda', () => {
    const r = http.get(`${BASE}/salud`, {
      headers: { 'x-forwarded-for': ip },
      tags: { tipo: 'lectura' },
    });
    saludMs.add(r.timings.duration);
    check(r, {
      'salud responde 200': (x) => x.status === 200,
      'postgres arriba': (x) => x.json('dependencias.postgres') === 'ok',
    });
  });

  group('sesion vigente', () => {
    const r = http.get(`${BASE}/sesion`, conSesion);
    check(r, {
      'sesion 200': (x) => x.status === 200,
      // Invariante del conteo ciego bajo carga: ninguna respuesta al Operador
      // puede filtrar el saldo esperado, tampoco cuando el sistema va apretado.
      'sin saldo esperado': (x) => !/saldo|esperado|tolerancia/i.test(x.body || ''),
    });
  });

  // Un operario tarda ~15 s por artículo: caminar, mirar, contar, dictar.
  // Sin esta pausa la prueba mediría un caudal que la operación real no tiene,
  // y el jitter evita que 500 usuarios virtuales caigan en lockstep — un
  // patrón sincronizado que produce picos artificiales.
  sleep(10 + Math.random() * 10);
}
