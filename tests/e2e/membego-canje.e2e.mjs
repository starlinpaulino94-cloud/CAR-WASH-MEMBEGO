/**
 * Ensayo de la costura con Membego: la membresía aplicada al cobro, el canje
 * anotado, y el lavado devuelto al anular.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ MEMBEGO VA SIMULADO Y LA BASE NO
 *
 * Lo que se prueba aquí es NUESTRA mitad: que el beneficio se aplique solo, que
 * la diferencia se calcule con nuestra tarifa, que el canje quede escrito en la
 * factura y que anular lo deshaga. Membego responde por HTTP y esa respuesta se
 * intercepta —el contrato ya está probado en su repositorio, con sus 1205
 * pruebas—; PostgreSQL, en cambio, es el de verdad, con RLS puesto, porque lo
 * que importa de este ensayo es LO QUE QUEDA ESCRITO.
 *
 * Interceptar también permite provocar lo que en producción no se puede pedir:
 * un Membego que rechaza el canje, o que no contesta.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = 'http://127.0.0.1:4174/';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASA ' : 'FALLA'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

const sql = (q) =>
  execFileSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'membego_e2e', '-tA', '-c', q])
    .toString().trim();

// ------------------------------------------------------- Datos de partida
// El lavado entra en membresía; el aromatizante no. Los niveles equiparan
// sedán=1 y SUV=2, que es lo que hace que un plan de sedán no cubra una SUV.
sql(`update public.services set included_in_membego = true
      where id = '44444444-4444-4444-4444-444444444444'`);
sql(`insert into public.vehicle_category_levels (company_id, category, level) values
       ('11111111-1111-1111-1111-111111111111','sedan',1),
       ('11111111-1111-1111-1111-111111111111','suv',2)
     on conflict (company_id, category) do update set level = excluded.level`);
sql(`insert into public.customers (id, company_id, name, phone, membego_customer_id, origin)
     values ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111',
             'Cliente Con Plan','8095550001','MG-CLI-1','membego')
     on conflict (id) do nothing`);

// ------------------------------------------------------- Membego simulado
/** Lo que contestará Membego en la próxima consulta. Se cambia por bloque. */
let respuestaFicha = null;
let respuestaCanje = null;
let respuestaReversa = null;
const llamadas = [];

const membresia = (over = {}) => ({
  id: 'MG-MEMB-1',
  nombre: 'Plan Sedán Ilimitado',
  eligible: true,
  usesLeft: 4,
  expiresAt: '2027-01-31T00:00:00.000Z',
  reason: null,
  coverage: {
    vehicleLevelMax: 1,
    unlimited: false,
    washesIncluded: 8,
    vehicles: [],
    covers: true,
    reason: null,
    ...over
  }
});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('    [consola]', m.text().slice(0, 140)); });

await page.route('**/api/membego/**', async route => {
  const url = route.request().url();
  const cuerpo = route.request().postDataJSON?.() ?? null;
  llamadas.push({ url, cuerpo });

  const responder = (r) => r === null
    ? route.fulfill({ status: 503, contentType: 'application/json',
                      body: JSON.stringify({ error: 'NO_DISPONIBLE', message: 'Membego no respondió.' }) })
    : route.fulfill({ status: r.status ?? 200, contentType: 'application/json',
                      body: JSON.stringify(r.body) });

  if (url.includes('/ficha'))    return responder(respuestaFicha);
  if (url.includes('/canjear'))  return responder(respuestaCanje);
  if (url.includes('/revertir')) return responder(respuestaReversa);
  return route.fulfill({ status: 404, body: '{}' });
});

// --------------------------------------------------------------- Acceso
console.log('\n[1] Acceso y caja abierta');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByLabel('Correo electrónico').fill('dueno@example.com');
await page.getByLabel('Contraseña').fill('clave-de-prueba');
await page.getByRole('button', { name: /Entrar/ }).click();
const sidebarPos = page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Ventas' });
await sidebarPos.waitFor({ timeout: 15000 }).catch(() => {});
check('se entra a la aplicación', await sidebarPos.isVisible().catch(() => false));

if (sql("select count(*) from cash_sessions where status='open'") === '0') {
  await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Caja' }).click();
  await page.waitForTimeout(1500);
  await page.getByLabel(/Fondo inicial/).fill('3000');
  await page.getByRole('button', { name: /Abrir caja/ }).click();
  await page.waitForTimeout(1800);
}
check('hay turno de caja abierto',
  sql("select count(*) from cash_sessions where status='open'") === '1');

// ------------------------------------------- La membresía cubre el lavado
console.log('\n[2] La membresía cubre: el beneficio se aplica SOLO');
respuestaFicha = { body: {
  vehicles: [{ id: 'MG-V-1', placa: 'A123456', marca: 'Toyota', modelo: 'Corolla' }],
  memberships: [membresia()], promotions: [], evaluatedAt: new Date().toISOString()
} };

await sidebarPos.click();
await page.waitForTimeout(1800);
await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.waitForTimeout(300);

await page.getByLabel('Buscar cliente registrado').fill('Cliente Con Plan');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Cliente Con Plan/ }).click();
await page.waitForTimeout(1500);

check('la membresía aparece sin que el cajero la busque',
  await page.getByText('Plan Sedán Ilimitado').first().isVisible().catch(() => false));
check('se ven los lavados que le quedan',
  await page.getByText(/4 lavados restantes/).isVisible().catch(() => false));
check('y cuándo se le vence',
  await page.getByText(/Vence/).first().isVisible().catch(() => false));

// Sedán a 1,000 cubierto entero: queda 0 y el ITBIS también.
const totalTexto = await page.locator('text=Total').last().locator('..').innerText();
check('el lavado cubierto deja el total en cero',
  /0\.00/.test(totalTexto), totalTexto.replace(/\n/g, ' '));

respuestaCanje = { body: {
  visitId: 'MG-VISIT-1', redemptionId: 'MG-RED-1', usesLeft: 3,
  unlimited: false, redeemedAt: new Date().toISOString()
} };

await page.getByRole('button', { name: /Cobrar/ }).click();
await page.waitForTimeout(2500);

const factura1 = sql(`select id from invoices where customer_id='77777777-7777-7777-7777-777777777777'
                       order by created_at desc limit 1`);
check('la factura se emitió', factura1.length === 36, factura1);
check('el importe cubierto quedó fuera de la base imponible',
  sql(`select membego_covered_cents from invoices where id='${factura1}'`) === '100000',
  sql(`select membego_covered_cents from invoices where id='${factura1}'`));
check('la factura recuerda QUÉ visita consumió el lavado',
  sql(`select membego_visit_id from invoices where id='${factura1}'`) === 'MG-VISIT-1');
check('y queda anotada como canjeada',
  sql(`select membego_canje_estado from invoices where id='${factura1}'`) === 'canjeado');
check('el canje se pidió DESPUÉS de facturar, con la factura como clave',
  llamadas.some(l => l.url.includes('/canjear') && l.cuerpo?.invoiceId === factura1));
check('el cajero ve cuántos lavados le quedan al cliente',
  await page.getByText(/Le quedan 3/).isVisible().catch(() => false));

// ---------------------------------------- El carro se sale del plan
console.log('\n[3] Un carro por encima del plan: la DIFERENCIA a pagar');
respuestaFicha = { body: {
  vehicles: [], promotions: [], evaluatedAt: new Date().toISOString(),
  memberships: [membresia({ covers: false, reason: 'VEHICLE_LEVEL_ABOVE_PLAN' })]
} };

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await sidebarPos.click();
await page.waitForTimeout(1500);

// SUV: el mismo lavado vale 1,500 y su plan solo llega al sedán, que vale 1,000.
await page.getByRole('button', { name: 'SUV', exact: true }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.waitForTimeout(300);
await page.getByLabel('Buscar cliente registrado').fill('Cliente Con Plan');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Cliente Con Plan/ }).click();
await page.waitForTimeout(2000);

check('se avisa de que el vehículo se sale del plan',
  await page.getByText(/categoría superior a la del plan/).isVisible().catch(() => false));
check('y se dice la diferencia exacta a pagar (1,500 − 1,000 = 500)',
  await page.getByText(/diferencia de.*500\.00/).isVisible().catch(() => false),
  await page.getByText(/diferencia de/).innerText().catch(() => 'no aparece'));

respuestaCanje = { body: {
  visitId: 'MG-VISIT-2', redemptionId: 'MG-RED-2', usesLeft: 2,
  unlimited: false, redeemedAt: new Date().toISOString()
} };
await page.getByLabel('Recibido').fill('600');
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Cobrar/ }).click();
await page.waitForTimeout(2500);

const factura2 = sql(`select id from invoices where customer_id='77777777-7777-7777-7777-777777777777'
                       order by created_at desc limit 1`);
check('el cliente paga SOLO el salto de categoría, con su ITBIS',
  sql(`select total_cents from invoices where id='${factura2}'`) === '59000',
  `${sql(`select total_cents from invoices where id='${factura2}'`)} centavos`);
check('lo que puso la membresía queda congelado en la factura',
  sql(`select membego_covered_cents from invoices where id='${factura2}'`) === '100000');

// ------------------------------------------ Membego rechaza el canje
console.log('\n[4] Membego rechaza el canje: la venta NO se cae');
respuestaFicha = { body: {
  vehicles: [], promotions: [], evaluatedAt: new Date().toISOString(),
  memberships: [membresia()]
} };
respuestaCanje = { status: 409, body: { error: 'REDEMPTION_CONFLICT', message: 'Sin lavados disponibles.' } };

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await sidebarPos.click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.getByLabel('Buscar cliente registrado').fill('Cliente Con Plan');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Cliente Con Plan/ }).click();
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Cobrar/ }).click();
await page.waitForTimeout(2500);

const factura3 = sql(`select id from invoices where customer_id='77777777-7777-7777-7777-777777777777'
                       order by created_at desc limit 1`);
check('la factura se emite igual: el cobro no depende de la fidelización',
  factura3 !== factura2 && factura3.length === 36);
check('el fallo queda ESCRITO en la factura, no en un log del servidor',
  sql(`select membego_canje_estado from invoices where id='${factura3}'`) === 'fallido');
check('con el motivo, para poder reintentarlo sabiendo qué pasó',
  sql(`select membego_canje_error from invoices where id='${factura3}'`).includes('lavados'),
  sql(`select membego_canje_error from invoices where id='${factura3}'`));
check('y el cajero se entera AHORA, con el cliente delante',
  await page.getByText(/Membego no descontó el lavado/).isVisible().catch(() => false));

// ------------------------------------------ Anular devuelve el lavado
console.log('\n[5] Anular la factura le devuelve el lavado al cliente');
respuestaReversa = { body: { visitId: 'MG-VISIT-1', usesLeft: 4, applied: true } };

await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Facturación' }).click();
await page.waitForTimeout(2500);

// La primera factura de la lista es la más reciente; la que interesa es la del
// bloque 2, que es la que llevaba visita. Se busca por su número.
const numero1 = sql(`select invoice_number from invoices where id='${factura1}'`);
await page.getByPlaceholder(/Buscar/).first().fill(numero1);
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Anular/ }).first().click();
await page.waitForTimeout(800);
await page.getByLabel(/Motivo de la anulación/).fill('Prueba de reversa del lavado');
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Anular y emitir nota/ }).click();
await page.waitForTimeout(3500);

check('la reversa se pidió por la VISITA, que es lo que consumió el lavado',
  llamadas.some(l => l.url.includes('/revertir') && l.cuerpo?.visitId === 'MG-VISIT-1'));
check('la reversa viaja con su motivo: Membego lo exige y con razón',
  llamadas.find(l => l.url.includes('/revertir'))?.cuerpo?.reason?.includes('Prueba de reversa') === true);
check('la factura queda como revertida',
  sql(`select membego_canje_estado from invoices where id='${factura1}'`) === 'revertido');
check('y sella cuándo se devolvió',
  sql(`select membego_revertido_at is not null from invoices where id='${factura1}'`) === 't');
check('al usuario se le dice que el lavado volvió al cliente',
  await page.getByText(/devolvió el lavado/).isVisible().catch(() => false));

// El guard del canje que llega TARDE —después de la anulación— se prueba en
// A6_membego_canje_tests.sql, con el rol y la empresa del cajero. Desde aquí
// habría que llamarlo como `postgres`, que no tiene empresa asignada, y lo que
// se comprobaría sería otra cosa.

// ------------------------------------------ Membego caído
console.log('\n[6] Membego caído: se sigue trabajando');
respuestaFicha = null;   // 503

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await sidebarPos.click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.getByLabel('Buscar cliente registrado').fill('Cliente Con Plan');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Cliente Con Plan/ }).click();
await page.waitForTimeout(2000);

check('se avisa de que Membego no respondió, sin bloquear la caja',
  await page.getByText(/Membego no respondió/).isVisible().catch(() => false));
const antes = sql(`select count(*) from invoices where customer_id='77777777-7777-7777-7777-777777777777'`);
await page.getByLabel('Recibido').fill('1200');
await page.waitForTimeout(400);
// Con el efectivo puesto, lo único que podría frenar el cobro sería Membego —y
// no lo hace. Comprobarlo ANTES de teclear el importe no probaría nada: el
// botón estaría desactivado por falta de pago, no por la fidelización.
check('con Membego caído el cobro sigue disponible: un lavadero no cierra por eso',
  await page.getByRole('button', { name: /Cobrar/ }).isEnabled().catch(() => false));
await page.getByRole('button', { name: /Cobrar/ }).click();
await page.waitForTimeout(2500);
check('la venta se cobra completa y se emite igual',
  sql(`select count(*) from invoices where customer_id='77777777-7777-7777-7777-777777777777'`)
    === String(Number(antes) + 1));

const ultima = sql(`select id from invoices where customer_id='77777777-7777-7777-7777-777777777777'
                     order by created_at desc limit 1`);
check('sin ficha no se inventa ningún beneficio',
  sql(`select membego_canje_estado from invoices where id='${ultima}'`) === 'sin_beneficio');

// ------------------------------------------------------------------ Cierre
await browser.close();
const fallos = results.filter(r => !r.pass);
console.log(`\n${results.length - fallos.length}/${results.length} comprobaciones pasan.`);
if (fallos.length) {
  console.log('\nFallan:');
  for (const f of fallos) console.log(`  · ${f.name}${f.detail ? `  [${f.detail}]` : ''}`);
  process.exit(1);
}
