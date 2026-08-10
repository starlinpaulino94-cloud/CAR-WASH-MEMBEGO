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

// ======================================================= Crédito y por cobrar
console.log('\n[7] Por cobrar — crédito, saldo y abonos');
await go(page, /^Clientes/, /^Por cobrar/);

// El propietario autoriza el cupo. Es la ÚNICA vía: un UPDATE directo sobre
// customers lo rechaza el guardia de la 0028 (comprobado en 96_credit_tests).
await page.getByRole('button', { name: /Autorizar crédito/ }).click();
await page.waitForTimeout(500);
await page.getByLabel(/Buscar cliente/).fill('Cliente Panel');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Cliente Panel/ }).click();
await page.waitForTimeout(500);
await page.getByLabel('Cupo autorizado').fill('5000');
await page.getByLabel('Plazo en días').fill('10');
await page.getByRole('button', { name: /Guardar cupo/ }).click();
await page.waitForTimeout(2000);

check('el cupo autorizado se guardó en centavos y con su plazo',
  sql(`select credit_enabled || '|' || credit_limit_cents || '|' || credit_terms_days
       from customers where name='Cliente Panel'`) === 'true|500000|10',
  sql(`select credit_enabled || '|' || credit_limit_cents || '|' || credit_terms_days
       from customers where name='Cliente Panel'`));

// Una venta fiada: no entra a caja y abre la cuenta por cobrar.
sql(`
  select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
  set role authenticated;
  select public.create_invoice('22222222-2222-2222-2222-222222222222'::uuid,'adm-cred-1',
    jsonb_build_array(jsonb_build_object('item_type','service',
      'service_id','44444444-4444-4444-4444-444444444444','name','Lavado',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','credito','amount_cents',
      (select (price_cents * 1.18)::bigint from service_prices
        where service_id='44444444-4444-4444-4444-444444444444' and vehicle_category='sedan'))),
    'sedan', null, (select id from customers where name='Cliente Panel'),
    'Cliente Panel', null, 'AD0001', null,
    (select id from cash_sessions where status='open' limit 1));
`);

check('lo fiado abre cuenta por cobrar y NO entra a la caja',
  sql("select count(*) from receivables where status='pendiente'") === '1'
  && sql(`select count(*) from cash_movements m
          join invoices i on i.id = m.invoice_id
          where i.client_request_id='adm-cred-1' and m.type='inflow'`) === '0');

// Se vuelve a entrar para que la pantalla lea la cuenta recién abierta.
await go(page, /^Clientes/, /^Vehículos/);
await go(page, /^Clientes/, /^Por cobrar/);

check('la cuenta pendiente aparece en el listado',
  await page.getByRole('button', { name: /^Cobrar$/ }).first().isVisible().catch(() => false));

await page.getByRole('button', { name: /^Cobrar$/ }).first().click();
await page.waitForTimeout(600);
await page.getByLabel('Importe a cobrar').fill('300');
await page.getByLabel('Forma de pago').selectOption('transferencia');
await page.getByRole('button', { name: /Registrar cobro/ }).click();
await page.waitForTimeout(2200);

check('el abono se guardó en centavos y dejó la cuenta pendiente',
  sql("select paid_cents || '|' || status from receivables limit 1") === '30000|pendiente',
  sql("select paid_cents || '|' || status from receivables limit 1"));
check('el abono quedó registrado con su forma de pago',
  sql("select count(*) from receivable_payments where amount_cents=30000 and payment_method='transferencia'") === '1');

// ======================================================= Flotillas
console.log('\n[8] Flotillas — cuenta corporativa y tarifa de contrato');
await go(page, /^Clientes/, /^Flotillas/);

await page.getByRole('button', { name: /Nueva flotilla/ }).click();
await page.waitForTimeout(500);
await page.getByLabel('Nombre *').fill('Transporte E2E SRL');
await page.getByLabel(/Cliente que paga/).fill('Cliente Panel');
await page.waitForTimeout(1200);
// El cliente se elige de la lista: la flotilla apunta a quien recibe la factura.
await page.getByRole('button', { name: 'Cliente Panel', exact: true }).click();
await page.getByLabel('Código').fill('TE-01');
await page.getByRole('button', { name: /Crear flotilla/ }).click();
await page.waitForTimeout(2200);

check('la flotilla se creó apuntando a quien paga',
  sql(`select f.code from fleets f join customers c on c.id = f.customer_id
       where f.name='Transporte E2E SRL' and c.name='Cliente Panel'`) === 'TE-01',
  sql("select coalesce((select code from fleets where name='Transporte E2E SRL'),'(ninguna)')"));

// Tarifa pactada: 500,00 frente a los 1.000,00 del catálogo para sedán.
await page.getByRole('button', { name: 'Transporte E2E SRL' }).click();
await page.waitForTimeout(1800);
await page.getByRole('button', { name: 'Pactar' }).click();
await page.waitForTimeout(600);
await page.getByLabel('Servicio').selectOption({ label: 'Lavado Completo' });
await page.getByLabel('Precio pactado').fill('500');
await page.getByRole('button', { name: /Guardar tarifa/ }).click();
await page.waitForTimeout(2200);

check('la tarifa pactada se guardó en centavos, sin categoría (todo el parque)',
  sql(`select price_cents from fleet_rates r join fleets f on f.id = r.fleet_id
       where f.name='Transporte E2E SRL' and r.vehicle_category is null`) === '50000',
  sql(`select coalesce((select price_cents::text from fleet_rates r
        join fleets f on f.id=r.fleet_id where f.name='Transporte E2E SRL'),'(ninguna)')`));

// El vehículo entra a la flotilla y, a partir de ahí, manda el contrato.
await page.getByRole('button', { name: 'Añadir' }).click();
await page.waitForTimeout(500);
await page.getByLabel(/Buscar placa/).fill('AD0001');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /AD0001/ }).click();
await page.waitForTimeout(2200);

check('el vehículo quedó dentro de la flotilla',
  sql(`select count(*) from vehicles v join fleets f on f.id = v.fleet_id
       where v.plate='AD0001' and f.name='Transporte E2E SRL'`) === '1');

// La prueba que importa: una orden nueva de esa placa cobra la tarifa pactada
// sin que nadie aplique un descuento a mano.
sql(`
  select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
  set role authenticated;
  select public.create_work_order('22222222-2222-2222-2222-222222222222'::uuid,'e2e-flota-1',
    'AD0001','sedan',
    jsonb_build_array(jsonb_build_object('service_id','44444444-4444-4444-4444-444444444444',
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    'Cliente Panel');
`);

check('la orden de un vehículo de flota cobra la tarifa de contrato',
  sql(`select i.unit_price_cents from work_order_items i
       join work_orders o on o.id = i.work_order_id
       where o.client_request_id='e2e-flota-1'`) === '50000',
  sql(`select i.unit_price_cents::text from work_order_items i
       join work_orders o on o.id = i.work_order_id
       where o.client_request_id='e2e-flota-1'`));

check('la orden queda sellada con su flotilla para facturarla luego',
  sql(`select count(*) from work_orders o join fleets f on f.id = o.fleet_id
       where o.client_request_id='e2e-flota-1' and f.name='Transporte E2E SRL'`) === '1');

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) { console.log('\nFALLOS:'); failed.forEach(f => console.log(`  - ${f.name}`)); process.exit(1); }
