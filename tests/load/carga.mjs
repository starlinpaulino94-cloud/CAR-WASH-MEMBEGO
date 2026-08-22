/**
 * Runner de carga sin dependencias (Fase 17 de la auditoría).
 * Ejecutar: TARGET=https://... SCENARIO=load node tests/load/carga.mjs
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE, Y QUÉ NO PRUEBA
 *
 * Las pruebas de carga que dan NÚMEROS REALES se corren contra un entorno
 * DESPLEGADO (Supabase + Vercel de staging), no contra el arnés local: aquí no
 * hay pooler, ni el hardware ni la red de producción. Este runner corre en
 * cualquier sitio —por eso no tiene dependencias— para que el dueño lo dispare
 * contra staging y llene LOAD_TEST_REPORT.md. Contra el arnés local solo sirve
 * de humo: demuestra que el runner mide, no que el sistema aguanta.
 *
 * Cuatro escenarios (Fase 17): load, stress, spike, soak. Cada uno es un perfil
 * de usuarios virtuales (VUs) en el tiempo. Mide p50/p95/p99, error rate y RPS,
 * y compara contra el presupuesto de performance (abajo). Sale != 0 si el
 * presupuesto se incumple, para que sirva de gate en CI si se quiere.
 */

const TARGET = process.env.TARGET || 'http://127.0.0.1:3001/';
const SCENARIO = process.env.SCENARIO || 'load';
const VUS = Number(process.env.VUS || '20');
const DURATION = Number(process.env.DURATION || '20'); // segundos
// Presupuesto de performance. NO son valores universales: se fijan según el
// producto (un mostrador de car wash, no un e-commerce con picos). Ajustables.
const BUDGET = {
  p95_ms: Number(process.env.BUDGET_P95 || '800'),
  p99_ms: Number(process.env.BUDGET_P99 || '1500'),
  error_rate: Number(process.env.BUDGET_ERR || '0.01'), // 1%
};

/** Perfil VUs(t) por escenario. Devuelve cuántos VUs activos en el segundo t. */
function perfil(scenario, t, dur) {
  switch (scenario) {
    case 'stress': // rampa creciente hasta 3×VUS: busca el punto de ruptura
      return Math.ceil(VUS * (1 + (2 * t) / dur));
    case 'spike': // tranquilo, pico brusco a mitad, y vuelta
      return t > dur * 0.4 && t < dur * 0.6 ? VUS * 5 : Math.ceil(VUS * 0.3);
    case 'soak': // constante y moderado, por mucho tiempo (memory/conn leaks)
      return Math.ceil(VUS * 0.5);
    case 'load': // carga esperada, constante
    default:
      return VUS;
  }
}

const latencias = [];
let ok = 0;
let err = 0;
let corriendo = true;

async function unaPeticion() {
  const t0 = performance.now();
  try {
    const res = await fetch(TARGET, { headers: { accept: 'application/json' } });
    // Consumir el cuerpo para medir el tiempo real de extremo a extremo.
    await res.arrayBuffer().catch(() => {});
    const dt = performance.now() - t0;
    latencias.push(dt);
    if (res.ok || res.status === 404 || res.status === 401) ok++;
    else err++;
  } catch {
    err++;
    latencias.push(performance.now() - t0);
  }
}

/** Un usuario virtual: peticiones en serie mientras esté activo. */
async function vu(estaActivo) {
  while (corriendo && estaActivo()) {
    await unaPeticion();
  }
}

function percentil(arr, p) {
  if (arr.length === 0) return 0;
  const orden = [...arr].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.floor((p / 100) * orden.length));
  return orden[i];
}

async function main() {
  console.log(`Carga · escenario=${SCENARIO} target=${TARGET} VUs base=${VUS} duración=${DURATION}s`);
  const inicio = Date.now();
  const activos = new Set();

  // Bucle de control: cada segundo ajusta el número de VUs al perfil.
  const control = setInterval(() => {
    const t = (Date.now() - inicio) / 1000;
    if (t >= DURATION) { corriendo = false; return; }
    const objetivo = perfil(SCENARIO, t, DURATION);
    while (activos.size < objetivo) {
      const id = {};
      activos.add(id);
      vu(() => activos.has(id)).finally(() => activos.delete(id));
    }
    while (activos.size > objetivo) {
      const [uno] = activos;
      activos.delete(uno);
    }
  }, 1000);

  // Arranque inmediato (no esperar al primer tick).
  for (let i = 0; i < perfil(SCENARIO, 0, DURATION); i++) {
    const id = {};
    activos.add(id);
    vu(() => activos.has(id)).finally(() => activos.delete(id));
  }

  await new Promise((r) => setTimeout(r, DURATION * 1000));
  corriendo = false;
  clearInterval(control);
  activos.clear();
  await new Promise((r) => setTimeout(r, 500)); // drenar en vuelo

  const total = ok + err;
  const rps = total / DURATION;
  const errRate = total ? err / total : 0;
  const p50 = percentil(latencias, 50);
  const p95 = percentil(latencias, 95);
  const p99 = percentil(latencias, 99);
  const max = latencias.length ? Math.max(...latencias) : 0;

  const f = (n) => n.toFixed(1);
  console.log('──────────────────────────────────────');
  console.log(`peticiones   ${total}  (ok=${ok} err=${err})`);
  console.log(`RPS          ${f(rps)}`);
  console.log(`error rate   ${(errRate * 100).toFixed(2)}%`);
  console.log(`p50          ${f(p50)} ms`);
  console.log(`p95          ${f(p95)} ms   (presupuesto ${BUDGET.p95_ms})`);
  console.log(`p99          ${f(p99)} ms   (presupuesto ${BUDGET.p99_ms})`);
  console.log(`max          ${f(max)} ms`);
  console.log('──────────────────────────────────────');

  const incumple = [];
  if (p95 > BUDGET.p95_ms) incumple.push(`p95 ${f(p95)} > ${BUDGET.p95_ms}`);
  if (p99 > BUDGET.p99_ms) incumple.push(`p99 ${f(p99)} > ${BUDGET.p99_ms}`);
  if (errRate > BUDGET.error_rate) incumple.push(`error rate ${(errRate * 100).toFixed(2)}% > ${BUDGET.error_rate * 100}%`);

  if (incumple.length) {
    console.log('PRESUPUESTO INCUMPLIDO: ' + incumple.join(' · '));
    process.exit(1);
  }
  console.log('presupuesto cumplido.');
}

main();
