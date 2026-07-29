/**
 * Ensayo de extremo a extremo de Órdenes y Kanban, contra la pila real:
 * navegador -> supabase-js -> PostgREST -> PostgreSQL con RLS.
 *
 * Requiere `tests/e2e/reset.sh`, el proxy en el 3002 y la aplicación en el 4174.
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

// Bahías y operarios que la semilla base no trae.
sql(`
  insert into public.bays (company_id, branch_id, name, type, status) values
    ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Bahía 1','lavado','disponible'),
    ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Bahía 2','lavado','disponible');
  insert into auth.users (id, email) values
    ('77777777-7777-7777-7777-777777777777','operario@example.com');
  update public.profiles set company_id='11111111-1111-1111-1111-111111111111',
         branch_id='22222222-2222-2222-2222-222222222222', role='operario',
         full_name='Lavador E2E', commission_bps=1500
   where id='77777777-7777-7777-7777-777777777777';
`);

async function login(page, email, view) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('clave-de-prueba');
  await page.getByRole('button', { name: /Entrar/ }).click();
  // El nombre accesible incluye el badge de la cola cuando hay vehículos, así
  // que se busca por prefijo en lugar de coincidencia exacta.
  const nav = page.getByRole('button', { name: view });
  await nav.waitFor({ timeout: 15000 });
  await nav.click();
  await page.waitForTimeout(1800);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// ============================================================ Registro
console.log('\n[1] Órdenes — registrar llegada');
await login(page, 'cajero@example.com', /^Órdenes de Servicio/);

check('la vista arranca sin vehículos en taller',
  await page.getByText('No hay vehículos en el taller ahora mismo.').isVisible().catch(() => false));

await page.getByRole('button', { name: /Registrar llegada/ }).first().click();
await page.waitForTimeout(1500);

check('el catálogo de servicios llega desde la base',
  await page.getByRole('button', { name: /Lavado Completo/ }).isVisible().catch(() => false));

check('no se puede registrar sin placa ni servicios',
  await page.getByRole('button', { name: /Registrar llegada$/ }).last().isDisabled().catch(() => false));

await page.getByLabel('Placa *').fill('kb-100 1');
await page.getByLabel('Cliente').fill('Cliente Kanban');
await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Registrar llegada$/ }).last().click();
await page.waitForTimeout(2500);

check('la orden se creó en la base de datos',
  sql("select count(*) from work_orders") === '1');
check('la placa quedó normalizada por el servidor',
  sql("select vehicle_plate from work_orders") === 'KB1001',
  sql("select vehicle_plate from work_orders"));
check('los totales se derivan del catálogo en centavos',
  sql("select total_cents from work_orders") === '118000',
  sql("select total_cents from work_orders"));
check('la orden nace pendiente',
  sql("select status from work_orders") === 'pendiente');

// El badge de la cola sale de una consulta de solo-conteo contra la base.
const sidebarBadge = async () => {
  const txt = await page.getByRole('button', { name: /^Órdenes de Servicio/ }).innerText();
  return txt.replace(/[^0-9]/g, '');
};
check('el badge de la barra lateral refleja el dato REAL de la base',
  (await sidebarBadge()) === '1', `badge="${await sidebarBadge()}"`);
check('se dio de alta el vehículo',
  sql("select count(*) from vehicles where plate='KB1001'") === '1');
check('la interfaz confirma el registro',
  await page.getByText(/registrada para KB1001/).isVisible().catch(() => false));

// ============================================================ Kanban
console.log('\n[2] Kanban — flujo de operación');
await page.getByRole('button', { name: /^Fila & Cola Kanban/ }).click();
await page.waitForTimeout(2000);

check('la tarjeta aparece en la columna de llegadas',
  await page.getByText('KB1001').first().isVisible().catch(() => false));
check('la cabecera informa de las bahías libres',
  await page.getByText(/2 de 2 bahías libres/).isVisible().catch(() => false));

// Estado no alcanzable: desde "pendiente" no debe ofrecerse "Entregado".
const buttonsPendiente = await page.getByRole('button', { name: /Mover a/ }).allInnerTexts();
check('solo se ofrecen transiciones válidas desde el estado actual',
  !buttonsPendiente.some(t => t.includes('Entregado')),
  buttonsPendiente.join(' · '));

await page.getByRole('button', { name: /Mover a En espera/ }).click();
await page.waitForTimeout(2000);
check('la orden pasó a la cola',
  sql("select status from work_orders") === 'en_espera');

// Iniciar lavado: exige elegir bahía, no la codifica.
await page.getByRole('button', { name: /Iniciar lavado/ }).click();
await page.waitForTimeout(800);
check('iniciar el lavado pide bahía explícitamente',
  await page.getByLabel('Bahía *').isVisible().catch(() => false));
check('los operarios de la sucursal están disponibles para asignar',
  await page.getByRole('button', { name: 'Lavador E2E', exact: true }).isVisible().catch(() => false));

await page.getByRole('button', { name: 'Lavador E2E', exact: true }).click();
await page.getByRole('button', { name: /^Iniciar$/ }).click();
await page.waitForTimeout(2500);

check('la orden está en lavado',
  sql("select status from work_orders") === 'en_proceso');
check('la bahía elegida quedó OCUPADA y vinculada a la orden',
  sql("select status from bays where name='Bahía 1'") === 'ocupada'
  && sql("select current_work_order_id is not null from bays where name='Bahía 1'") === 't',
  sql("select status from bays where name='Bahía 1'"));
check('el operario quedó asignado',
  sql("select count(*) from work_order_assignees") === '1');
check('la cabecera refleja una bahía menos',
  await page.getByText(/1 de 2 bahías libres/).isVisible().catch(() => false));

// Capacidad: una segunda llegada no puede entrar en la bahía ocupada.
sql(`
  select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
  set role authenticated;
  select public.create_work_order('22222222-2222-2222-2222-222222222222'::uuid,'e2e-wo-2',
    'ZZ0002','sedan',
    jsonb_build_array(jsonb_build_object('service_id','44444444-4444-4444-4444-444444444444',
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)));
`);
await page.getByRole('button', { name: /Actualizar/ }).click();
await page.waitForTimeout(2000);

await page.getByRole('button', { name: /Iniciar lavado/ }).click();
await page.waitForTimeout(800);
const bayOptions = await page.getByLabel('Bahía *').innerText();
check('la bahía ocupada ya no se ofrece como opción',
  !bayOptions.includes('Bahía 1') && bayOptions.includes('Bahía 2'),
  bayOptions.replace(/\n/g, ' · '));
await page.getByRole('button', { name: /Cancelar/ }).click();
await page.waitForTimeout(400);

// Salir de lavado libera la bahía. Antes esto no ocurría nunca.
await page.getByRole('button', { name: /Mover a Control de calidad/ }).click();
await page.waitForTimeout(2500);

check('salir de lavado LIBERA la bahía',
  sql("select status from bays where name='Bahía 1'") === 'disponible'
  && sql("select current_work_order_id is null from bays where name='Bahía 1'") === 't',
  sql("select status from bays where name='Bahía 1'"));
check('la cabecera vuelve a mostrar las dos bahías libres',
  await page.getByText(/2 de 2 bahías libres/).isVisible().catch(() => false));

await page.getByRole('button', { name: /Mover a Listo/ }).click();
await page.waitForTimeout(2200);
await page.getByRole('button', { name: /Mover a Entregado/ }).click();
await page.waitForTimeout(2500);

check('la orden quedó entregada',
  sql("select status from work_orders where vehicle_plate='KB1001'") === 'entregado');

// Al entregar sale de la cola: el badge debe bajar sin recargar la página.
await page.waitForTimeout(900);
check('el badge baja al salir el vehículo de la cola',
  (await page.getByRole('button', { name: /^Órdenes de Servicio/ }).innerText()).replace(/[^0-9]/g, '') === '1',
  `en taller según la base: ${sql("select count(*) from work_orders where status not in ('entregado','cancelado')")}`);
check('al entregar se generó la comisión del operario',
  sql("select count(*) from commissions") === '1');
// 1.000,00 al 15% = 150,00
check('la comisión aplica la tasa del operario sobre la línea',
  sql("select amount_cents from commissions") === '15000',
  sql("select amount_cents from commissions"));
check('entregar contabilizó la visita del cliente',
  sql("select total_visits from customers where name='Cliente Kanban'") === '1');
check('cada cambio de estado quedó en la bitácora',
  Number(sql("select count(*) from audit_logs where action='CAMBIO_ESTADO_ORDEN'")) >= 5,
  sql("select count(*) from audit_logs where action='CAMBIO_ESTADO_ORDEN'"));

// ============================================================ Autorización
console.log('\n[3] Autorización aplicada por la base');
const otherOrder = sql("select id from work_orders where vehicle_plate='ZZ0002'");
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('membego_cw_auth')).access_token);

// Transición inválida llamando al API directamente, saltándose la interfaz.
const jump = await page.evaluate(async ([id, tk]) => {
  const r = await fetch('http://127.0.0.1:3002/rest/v1/rpc/advance_work_order', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ p_order_id: id, p_new_status: 'entregado' })
  });
  return { status: r.status, body: (await r.text()).slice(0, 120) };
}, [otherOrder, token]);

check('la base rechaza un salto de estado inválido aunque se llame al API',
  jump.status >= 400, `HTTP ${jump.status}`);
check('la orden conserva su estado tras el intento',
  sql(`select status from work_orders where id='${otherOrder}'`) === 'pendiente');

// ============================================================ Órdenes
console.log('\n[4] Órdenes — filtros y paginación');
await page.getByRole('button', { name: /^Órdenes de Servicio/ }).click();
await page.waitForTimeout(1800);

check('el filtro "En taller" excluye lo entregado',
  (await page.locator('tbody tr').count()) === 1,
  `${await page.locator('tbody tr').count()} fila(s)`);

await page.getByRole('button', { name: 'Todas', exact: true }).click();
await page.waitForTimeout(1500);
check('el filtro "Todas" muestra el histórico completo',
  (await page.locator('tbody tr').count()) === 2,
  `${await page.locator('tbody tr').count()} fila(s)`);

await page.getByLabel('Buscar orden').fill('KB1001');
await page.waitForTimeout(1300);
check('la búsqueda filtra en el servidor',
  (await page.locator('tbody tr').count()) === 1
  && await page.getByText('KB1001').first().isVisible().catch(() => false),
  `${await page.locator('tbody tr').count()} fila(s)`);

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) { console.log('\nFALLOS:'); failed.forEach(f => console.log(`  - ${f.name}`)); process.exit(1); }
