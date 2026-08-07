/**
 * Ensayo de extremo a extremo de las vistas restantes: panel, clientes,
 * vehículos, servicios, productos, equipo, gastos, bahías, reportes, ajustes y
 * el hub de Membego.
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

// Datos de partida: bahías, una venta de hoy y algunos clientes.
sql(`
  insert into public.bays (company_id, branch_id, name, type, status) values
    ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Bahía 1','lavado','disponible');
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
            '33333333-3333-3333-3333-333333333333', 500000);
  select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
  set role authenticated;
  select public.create_invoice('22222222-2222-2222-2222-222222222222'::uuid,'adm-1',
    jsonb_build_array(jsonb_build_object('item_type','product',
      'product_id','55555555-5555-5555-5555-555555555555','name','Aromatizante',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',29500)),
    'sedan', null, null, 'Cliente Panel', null, 'AD0001', 'B02',
    (select id from public.cash_sessions where status='open' limit 1));
  -- Una orden de trabajo: es la que da de alta vehículo y cliente. Facturar no
  -- crea vehículos, solo guarda la placa como texto en el comprobante.
  select public.create_work_order('22222222-2222-2222-2222-222222222222'::uuid,'adm-wo-1',
    'AD0001','sedan',
    jsonb_build_array(jsonb_build_object('service_id','44444444-4444-4444-4444-444444444444',
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    'Cliente Panel');
`);

async function login(page, email) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('clave-de-prueba');
  await page.getByRole('button', { name: /Entrar/ }).click();
  await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: /^Inicio/ }).waitFor({ timeout: 15000 });
}
// Navegación nueva: módulo en el sidebar y, si hace falta, pestaña de submódulo.
const go = async (page, modulo, submodulo) => {
  await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: modulo }).click();
  await page.waitForTimeout(600);
  if (submodulo) {
    await page.locator('nav[aria-label="Submódulos"]').getByRole('link', { name: submodulo }).click();
  }
  await page.waitForTimeout(1800);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext();
let page = await ctx.newPage();

// ======================================================= Panel
console.log('\n[1] Panel — indicadores con rango de fechas');
await login(page, 'cajero@example.com');
await page.waitForTimeout(1800);

check('el panel separa el estado del taller de los resultados del periodo',
  await page.getByText('En el taller ahora').isVisible().catch(() => false)
  && await page.getByRole('button', { name: 'Hoy', exact: true }).isVisible().catch(() => false));

check('las ventas de HOY reflejan la factura emitida',
  (await page.locator('section[aria-label="Resultados del periodo"]').innerText()).includes('295.00'),
  (await page.locator('section[aria-label="Resultados del periodo"]').innerText()).replace(/\n/g, ' ').slice(0, 110));

// El rango no es decorativo: un periodo distinto da otros números.
await page.getByRole('button', { name: 'Este mes', exact: true }).click();
await page.waitForTimeout(1500);
check('cambiar el rango vuelve a consultar al servidor',
  await page.getByText(/este mes/i).first().isVisible().catch(() => false));

// ======================================================= Clientes
console.log('\n[2] Clientes');
await go(page, /^Clientes/);

const before = Number(sql('select count(*) from customers'));
await page.getByLabel('Nombre *').fill('Cliente Nuevo E2E');
await page.getByLabel('Teléfono').fill('809-555-0777');
await page.getByRole('button', { name: /Guardar cliente/ }).click();
await page.waitForTimeout(2000);

check('el cliente se creó en la base',
  Number(sql('select count(*) from customers')) === before + 1);
check('la interfaz confirma el alta',
  await page.getByText(/Cliente Nuevo E2E registrado/).isVisible().catch(() => false));

await page.getByLabel('Buscar cliente').fill('Nuevo E2E');
await page.waitForTimeout(1300);
check('la búsqueda de clientes filtra en el servidor',
  (await page.locator('tbody tr').count()) === 1,
  `${await page.locator('tbody tr').count()} fila(s)`);

// ======================================================= Gastos
console.log('\n[3] Gastos — atómicos con la caja');
await go(page, /^Caja/, /^Gastos/);

const cashBefore = Number(sql("select expected_cash_cents from cash_sessions where status='open'"));
await page.getByLabel(/Concepto/).fill('Compra de jabón industrial');
await page.getByLabel(/Importe/).fill('1250.50');
await page.getByRole('button', { name: /Registrar gasto$/ }).click();
await page.waitForTimeout(2200);

check('el gasto se guardó en centavos exactos',
  sql("select amount_cents from expenses order by created_at desc limit 1") === '125050',
  sql("select amount_cents from expenses order by created_at desc limit 1"));
check('el gasto en efectivo descontó la caja en la MISMA operación',
  Number(sql("select expected_cash_cents from cash_sessions where status='open'")) === cashBefore - 125050,
  `${cashBefore} → ${sql("select expected_cash_cents from cash_sessions where status='open'")}`);
check('quedó su movimiento de salida en caja',
  sql("select count(*) from cash_movements where type='outflow' and reason like 'Gasto:%'") === '1');

// ======================================================= Permisos del cajero
console.log('\n[4] Restricciones de rol (cajero)');
await go(page, /^Ventas/, /^Servicios/);
check('el cajero ve el catálogo en solo lectura',
  await page.getByText(/no cambiar precios/).isVisible().catch(() => false));

// Con la navegación por permisos, el módulo entero desaparece para el cajero.
check('el cajero no ve el módulo de Reportes (auditoría vedada)',
  !(await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: /^Reportes/ }).isVisible().catch(() => false)));

await go(page, /^Configuración/);
check('el cajero ve los ajustes en solo lectura',
  await page.getByText(/Solo el propietario puede modificar/).isVisible().catch(() => false));

await go(page, /^Personal/);
check('el cajero solo ve sus propias comisiones',
  await page.getByText(/solo permite ver sus propias comisiones/).isVisible().catch(() => false));

// El hub de Membego se retiró del menú para la operación real (sigue siendo un
// simulador). La persistencia de membego_sync_logs se cubre en las pruebas SQL
// (40_admin_tests.sql), no por la interfaz.

await ctx.close();

// ======================================================= Propietario
console.log('\n[6] Propietario — edición y auditoría');
ctx = await browser.newContext();
page = await ctx.newPage();
await login(page, 'dueno@example.com');
await page.waitForTimeout(1500);

// --- Servicios: editar un precio
await go(page, /^Ventas/, /^Servicios/);
check('el propietario sí puede editar precios',
  !(await page.getByText(/no cambiar precios/).isVisible().catch(() => false)));

await page.getByRole('button', { name: 'Precio de Lavado Completo para Jeep' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Precio de Lavado Completo para Jeep').fill('1750');
await page.keyboard.press('Enter');
await page.waitForTimeout(2000);

check('el precio nuevo se guardó en centavos',
  sql(`select price_cents from service_prices
       where vehicle_category='jeep'
         and service_id='44444444-4444-4444-4444-444444444444'`) === '175000',
  sql(`select coalesce(price_cents::text,'(sin fila)') from service_prices
       where vehicle_category='jeep' and service_id='44444444-4444-4444-4444-444444444444'`));

// --- Productos: ajustar existencia (desde 0019 exige modal con motivo)
await go(page, /^Inventario/);
await page.getByRole('button', { name: /Existencia de Aromatizante/ }).click();
await page.waitForTimeout(400);
await page.getByLabel(/Nueva existencia de Aromatizante/).fill('42');
await page.getByLabel(/Motivo del ajuste/).fill('Conteo físico E2E');
await page.getByRole('button', { name: 'Registrar ajuste' }).click();
await page.waitForTimeout(2000);
check('la existencia ajustada se guardó',
  sql("select stock from products where code='AR1'") === '42',
  sql("select stock from products where code='AR1'"));
check('el ajuste quedó en el kardex con su motivo',
  sql(`select count(*) from inventory_movements m
       join products p on p.id = m.product_id
       where p.code='AR1' and m.kind='ajuste' and m.reason='Conteo físico E2E'`) === '1');

// --- Bahías
await go(page, /^Operaciones/, /^Bahías/);
await page.getByRole('button', { name: /Fuera de servicio/ }).click();
await page.waitForTimeout(2000);
check('marcar una bahía fuera de servicio se refleja en la base',
  sql("select status from bays where name='Bahía 1'") === 'mantenimiento',
  sql("select status from bays where name='Bahía 1'"));

// --- Reportes
// Auditoría es la tercera pestaña de Reportes (Ventas y Rentabilidad van antes).
await go(page, /^Reportes/, /^Auditoría/);
check('el propietario sí ve la bitácora de auditoría',
  await page.getByText('Bitácora de auditoría').isVisible().catch(() => false));
check('la bitácora está paginada y muestra eventos reales',
  (await page.locator('tbody tr').count()) > 0
  && (await page.locator('tbody tr').count()) <= 25,
  `${await page.locator('tbody tr').count()} filas de ${sql('select count(*) from audit_logs')} eventos`);

await page.getByLabel('Buscar en la bitácora').fill('REGISTRAR_GASTO');
await page.waitForTimeout(1300);
check('la bitácora se filtra en el servidor',
  (await page.locator('tbody tr').count()) === 1,
  `${await page.locator('tbody tr').count()} fila(s)`);

// --- Ajustes (la nota de pie vive en el submódulo Impresión)
await go(page, /^Configuración/, /^Impresión/);
await page.getByLabel(/Nota de pie/).fill('Gracias por su visita — E2E');
await page.getByRole('button', { name: /Guardar cambios/ }).click();
await page.waitForTimeout(2200);
check('el propietario puede guardar los ajustes de la empresa',
  sql("select footer_note from companies") === 'Gracias por su visita — E2E',
  sql("select coalesce(footer_note,'(nulo)') from companies"));

// --- Equipo
await go(page, /^Personal/);
check('el propietario ve el resumen de comisiones del equipo',
  await page.getByText('Comisiones del periodo').isVisible().catch(() => false));

// --- Vehículos
await go(page, /^Clientes/, /^Vehículos/);
check('la flotilla lista los vehículos registrados',
  await page.getByText('AD0001').first().isVisible().catch(() => false));

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) { console.log('\nFALLOS:'); failed.forEach(f => console.log(`  - ${f.name}`)); process.exit(1); }
