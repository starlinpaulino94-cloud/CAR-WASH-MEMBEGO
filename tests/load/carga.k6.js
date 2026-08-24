// Prueba de carga con k6 (Fase 17). Para corridas REALES contra staging.
//   k6 run -e TARGET=https://tu-staging.vercel.app tests/load/carga.k6.js
//
// k6 es el estándar para esto: da percentiles fiables, rampas y umbrales. El
// runner sin dependencias (carga.mjs) existe para cuando k6 no está instalado;
// este da mejores números y conviene para el informe formal.
//
// Cuatro escenarios de la Fase 17 en un solo archivo. Se elige con
// -e SCENARIO=load|stress|spike|soak (por defecto: load).

import http from 'k6/http';
import { check } from 'k6';

const TARGET = __ENV.TARGET || 'http://127.0.0.1:3001/';
const SCENARIO = __ENV.SCENARIO || 'load';

// Presupuesto de performance: se fija según el producto (mostrador de car wash),
// no con valores universales. Un p95 de 800 ms es holgado para este uso.
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
  scenarios: {
    [SCENARIO]: perfil(SCENARIO),
  },
};

function perfil(s) {
  switch (s) {
    case 'stress': // rampa hasta encontrar el punto de ruptura
      return {
        executor: 'ramping-vus', startVUs: 10,
        stages: [
          { duration: '1m', target: 50 },
          { duration: '1m', target: 150 },
          { duration: '1m', target: 300 },
          { duration: '30s', target: 0 },
        ],
      };
    case 'spike': // pico repentino, como una promoción anunciada
      return {
        executor: 'ramping-vus', startVUs: 10,
        stages: [
          { duration: '20s', target: 20 },
          { duration: '10s', target: 300 },
          { duration: '30s', target: 300 },
          { duration: '10s', target: 20 },
        ],
      };
    case 'soak': // tráfico moderado sostenido: fugas de memoria/conexiones
      return { executor: 'constant-vus', vus: 30, duration: '30m' };
    case 'load': // carga esperada, constante
    default:
      return { executor: 'constant-vus', vus: 30, duration: '2m' };
  }
}

export default function () {
  const res = http.get(TARGET, { headers: { accept: 'application/json' } });
  check(res, { 'estado aceptable': (r) => r.status < 500 });
}
