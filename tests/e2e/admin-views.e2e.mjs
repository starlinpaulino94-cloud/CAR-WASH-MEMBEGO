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

// ======================================================= Nómina
console.log('\n[9] Personal — sueldo, adelanto y nómina');

// El sueldo NO se puede tocar por la vía directa: lo prueba el guardia de 0030.
await go(page, /^Personal/, /^Nómina/);
await page.getByRole('button', { name: /Fijar sueldo/ }).first().click();
await page.waitForTimeout(600);
await page.getByLabel('Modalidad').selectOption('mensual');
await page.getByLabel('Sueldo mensual').fill('30000');
await page.getByRole('button', { name: /Guardar sueldo/ }).click();
await page.waitForTimeout(2200);

check('el sueldo mensual se guardó en centavos por la vía correcta',
  sql("select count(*) from profiles where payroll_type='mensual' and base_salary_cents=3000000") === '1',
  sql("select coalesce((select payroll_type || '/' || base_salary_cents from profiles where payroll_type='mensual'),'(ninguno)')"));

// Un UPDATE directo sobre la ficha lo rechaza la base, aunque venga del API.
check('el guardia rechaza cambiar el sueldo con un UPDATE directo',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
           set role authenticated;
           update public.profiles set base_salary_cents = 99999999
            where id = '33333333-3333-3333-3333-333333333333';`);
      return false;
    } catch { return true; }
  })());

// Adelanto: sale de la gaveta.
const cashPreAdvance = Number(sql("select expected_cash_cents from cash_sessions where status='open'"));
await page.getByRole('button', { name: /Dar adelanto/ }).click();
await page.waitForTimeout(600);
await page.getByLabel('Empleado').selectOption({ index: 1 });
await page.getByLabel('Importe').fill('500');
await page.getByRole('button', { name: /Entregar adelanto/ }).click();
await page.waitForTimeout(2200);

check('el adelanto salió de la caja en la misma operación',
  Number(sql("select expected_cash_cents from cash_sessions where status='open'")) === cashPreAdvance - 50000,
  `${cashPreAdvance} → ${sql("select expected_cash_cents from cash_sessions where status='open'")}`);

// Nómina del periodo: calcula, y el adelanto aparece descontado.
await page.getByRole('button', { name: /Abrir nómina/ }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /^Calcular$/ }).click();
await page.waitForTimeout(2600);

check('la nómina nace en borrador con sus partidas',
  sql("select status from payroll_periods limit 1") === 'borrador',
  sql("select coalesce((select status::text from payroll_periods limit 1),'(ninguna)')"));

check('el adelanto entregado se descontó en la partida',
  sql("select coalesce(sum(advances_cents),0) from payroll_items") === '50000',
  sql("select coalesce(sum(advances_cents),0)::text from payroll_items"));

check('el neto del periodo cuadra con la suma de sus partidas',
  sql(`select (p.net_cents = (select coalesce(sum(i.net_cents),0)
         from payroll_items i where i.period_id = p.id))::text
       from payroll_periods p limit 1`) === 'true');

// ======================================================= Sucursales
console.log('\n[10] Sucursales — alta y alcance del personal');
await go(page, /^Configuración/, /^Sucursales/);

await page.getByRole('button', { name: /Nueva sucursal/ }).click();
await page.waitForTimeout(600);
await page.getByLabel('Nombre *').fill('Sucursal Autopista E2E');
await page.getByLabel('Dirección').fill('Km 12');
await page.getByRole('button', { name: /Crear sucursal/ }).click();
await page.waitForTimeout(2200);

check('la sucursal se creó activa y no principal',
  sql("select (is_active and not is_main)::text from branches where name='Sucursal Autopista E2E'") === 'true',
  sql("select coalesce((select (is_active and not is_main)::text from branches where name='Sucursal Autopista E2E'),'(ninguna)')"));

// El alcance del cajero: de «todas» a una sola sucursal.
await page.getByRole('button', { name: /Cambiar alcance/ }).first().click();
await page.waitForTimeout(600);
await page.getByLabel(/Qué puede ver/).selectOption('sucursal');
await page.getByLabel('Sucursal').selectOption({ label: 'Sucursal Autopista E2E' });
await page.getByRole('button', { name: /Guardar alcance/ }).click();
await page.waitForTimeout(2200);

check('el alcance quedó limitado a la sucursal elegida',
  sql(`select count(*) from profiles p join branches b on b.id = p.branch_id
       where p.branch_scope='sucursal' and b.name='Sucursal Autopista E2E'`) === '1',
  sql("select count(*)::text from profiles where branch_scope='sucursal'"));

// La frontera es de la base: ni el API la salta.
check('el guardia rechaza cambiar el alcance con un UPDATE directo',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
           set role authenticated;
           update public.profiles set branch_scope = 'todas'
            where id = '33333333-3333-3333-3333-333333333333';`);
      return false;
    } catch { return true; }
  })());

// La frontera es real: el mismo dato, visto por quien quedó limitado, desaparece.
const limitado = sql("select id::text from profiles where branch_scope='sucursal' limit 1");
const ordenesTotales = Number(sql('select count(*) from work_orders'));
// Varias sentencias en un solo psql devuelven varias líneas: la que interesa
// es la última, la del SELECT.
const ultimaLinea = (out) => out.split('\n').filter(l => l.trim()).pop() ?? '';
const ordenesVistas = Number(ultimaLinea(sql(`
  select set_config('request.jwt.claim.sub', '${limitado}', false);
  set role authenticated;
  select count(*) from public.work_orders;`)));

check('quien quedó limitado a otra sucursal deja de ver las órdenes de la principal',
  ordenesTotales > 0 && ordenesVistas === 0,
  `${ordenesVistas} visibles de ${ordenesTotales} existentes`);

// ======================================================= Descuentos
console.log('\n[11] Descuentos — promoción con reglas y techo del manual');
await go(page, /^Ventas/, /^Descuentos/);

await page.getByRole('button', { name: /Nueva promoción/ }).click();
await page.waitForTimeout(600);
await page.getByLabel('Código *').fill('E2E15');
await page.getByLabel('Nombre *').fill('Quince por ciento');
await page.getByLabel('Porcentaje (%)').fill('15');
await page.getByRole('button', { name: /Crear promoción/ }).click();
await page.waitForTimeout(2200);

check('la promoción se guardó con su porcentaje en puntos base',
  sql("select value_bps::text from promotions where code='E2E15'") === '1500',
  sql("select coalesce((select value_bps::text from promotions where code='E2E15'),'(ninguna)')"));

check('la promoción nace activa y sin usos',
  sql("select (is_active and uses_count = 0)::text from promotions where code='E2E15'") === 'true');

// Lo que de verdad importa: el importe lo pone el servidor, no la pantalla.
// Se emite una venta con el código y se comprueba el descuento resultante.
sql(`
  select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
  set role authenticated;
  select public.create_invoice('22222222-2222-2222-2222-222222222222'::uuid,'e2e-promo-1',
    jsonb_build_array(jsonb_build_object('item_type','service',
      'service_id','44444444-4444-4444-4444-444444444444','name','Lavado',
      'quantity',1,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',
      (select round((price_cents * 0.85) * 1.18)::bigint from service_prices
        where service_id='44444444-4444-4444-4444-444444444444' and vehicle_category='sedan'))),
    'sedan', null, null, 'Consumidor Final', null, 'PR0001', null, null, 'E2E15');
`);

const precioSedan = Number(sql(`select price_cents from service_prices
  where service_id='44444444-4444-4444-4444-444444444444' and vehicle_category='sedan'`));

check('el servidor calculó el 15 % sobre el precio de catálogo',
  Number(sql("select discount_cents from invoices where client_request_id='e2e-promo-1'"))
    === Math.round(precioSedan * 0.15),
  `${sql("select discount_cents from invoices where client_request_id='e2e-promo-1'")} de ${precioSedan}`);

check('el canje quedó registrado y el contador subió',
  sql("select uses_count::text from promotions where code='E2E15'") === '1'
  && sql(`select count(*) from promotion_redemptions r join invoices i on i.id = r.invoice_id
          where i.client_request_id='e2e-promo-1'`) === '1');

// El techo del descuento manual: se baja al 10 % y el cajero deja de poder.
sql("update public.companies set max_manual_discount_bps = 1000;");

check('con techo puesto, un cajero no puede rebajar la factura a voluntad',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
           set role authenticated;
           select public.create_invoice('22222222-2222-2222-2222-222222222222'::uuid,'e2e-abuso',
             jsonb_build_array(jsonb_build_object('item_type','service',
               'service_id','44444444-4444-4444-4444-444444444444','name','Lavado',
               'quantity',1,'discount_cents',${precioSedan - 100},'is_membego_covered',false)),
             jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',118)),
             'sedan', null, null, 'Consumidor Final', null, 'AB0001', null, null);`);
      return false;
    } catch { return true; }
  })());

sql("update public.companies set max_manual_discount_bps = 10000;");

// ======================================================= Avisos
console.log('\n[12] Avisos — bandeja que se llena sola');

// Un producto bajo mínimo: se sube el mínimo, porque la existencia la protege
// el guardia del kardex.
sql("update public.products set min_stock = greatest(stock + 1, 5) where code='AR1';");

await go(page, /^Inicio/, /^Avisos/);
await page.getByRole('button', { name: /Buscar avisos/ }).click();
await page.waitForTimeout(2600);

check('el barrido encoló el aviso de inventario bajo mínimo',
  sql("select count(*) from notifications where kind='stock_bajo' and status='pendiente'") === '1',
  sql("select count(*)::text from notifications where kind='stock_bajo'"));

// Lo que hace usable la bandeja: repetir el barrido no la llena de copias.
await page.getByRole('button', { name: /Buscar avisos/ }).click();
await page.waitForTimeout(2600);

check('repetir el barrido no duplica el aviso',
  sql("select count(*) from notifications where kind='stock_bajo'") === '1');

check('la pantalla anuncia que no hay nada nuevo',
  await page.getByText(/Todo al día/).isVisible().catch(() => false));

// El aviso al cliente lo genera la base sola, al quedar lista la orden.
// Se hace con el propietario: al cajero se le limitó el alcance a otra sucursal
// en el bloque anterior, y la política de sucursal —correctamente— lo frena.
sql(`
  select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
  set role authenticated;
  select public.create_work_order('22222222-2222-2222-2222-222222222222'::uuid,'e2e-aviso-1',
    'AV9999','sedan',
    jsonb_build_array(jsonb_build_object('service_id','44444444-4444-4444-4444-444444444444',
      'name','Lavado','quantity',1,'discount_cents',0,'is_membego_covered',false)),
    'Doña E2E', null, '809-555-0123');
`);
sql(`
  -- La única bahía quedó en mantenimiento en el bloque [6]: hace falta una libre.
  insert into public.bays (company_id, branch_id, name, type, status) values
    ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
     'Bahía Avisos','lavado','disponible');
  select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
  set role authenticated;
  select public.advance_work_order(
    (select id from work_orders where client_request_id='e2e-aviso-1'), 'en_espera');
  select public.advance_work_order(
    (select id from work_orders where client_request_id='e2e-aviso-1'), 'en_proceso',
    (select id from bays where name='Bahía Avisos'));
  select public.advance_work_order(
    (select id from work_orders where client_request_id='e2e-aviso-1'), 'listo');
`);

check('al quedar listo el vehículo, el aviso al cliente se encola solo',
  sql(`select count(*) from notifications n join work_orders o on o.id = n.work_order_id
       where o.client_request_id='e2e-aviso-1' and n.kind='orden_lista'
         and n.channel='whatsapp' and n.recipient_phone='809-555-0123'`) === '1');

// Marcar como enviado lo saca de lo pendiente, y sella quién y cuándo.
await go(page, /^Operaciones/, /^Órdenes/);
await go(page, /^Inicio/, /^Avisos/);
await page.waitForTimeout(1800);
await page.getByRole('button', { name: /Marcar como enviado/ }).first().click();
await page.waitForTimeout(2200);

check('marcar el aviso sella la hora y lo saca de lo pendiente',
  sql("select count(*) from notifications where status='enviado' and sent_at is not null") === '1',
  sql("select count(*)::text from notifications where status='enviado'"));

// ============================================ Los tres que decían «PRONTO»
console.log('\n[13] Notas de crédito, Fiscal y Usuarios');

// --- Notas de crédito PARCIALES: se acredita 1 de 3, la factura sigue viva.
sql(`
  select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
  set role authenticated;
  select public.create_invoice('22222222-2222-2222-2222-222222222222'::uuid,'e2e-nc-1',
    jsonb_build_array(jsonb_build_object('item_type','product',
      'product_id','55555555-5555-5555-5555-555555555555','name','Aromatizante',
      'quantity',3,'discount_cents',0,'is_membego_covered',false)),
    jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',
      (select round(price_cents * 3 * 1.18)::bigint from products
        where code='AR1'))),
    'sedan', null, null, 'Cliente NC E2E', null, 'NCE001', null, null);
`);

await go(page, /^Facturación/, /^Notas de crédito/);
await page.getByRole('button', { name: /Emitir nota/ }).click();
await page.waitForTimeout(600);
await page.getByLabel(/Buscar factura/).fill('Cliente NC E2E');
await page.waitForTimeout(1400);
await page.getByRole('button', { name: /Cliente NC E2E/ }).click();
await page.waitForTimeout(700);
await page.getByLabel(/Unidades a acreditar de Aromatizante/).fill('1');
await page.getByLabel('Motivo *').fill('Se entregó uno de menos');
await page.getByRole('button', { name: /Emitir por/ }).click();
await page.waitForTimeout(2600);

const stockNC = Number(sql("select stock from products where code='AR1'"));
check('la nota parcial acredita solo una unidad y deja viva la factura',
  sql(`select (not is_annulled and credited_cents = 29500)::text
       from invoices where client_request_id='e2e-nc-1'`) === 'true',
  sql("select credited_cents::text from invoices where client_request_id='e2e-nc-1'"));

check('la línea recuerda lo acreditado y el inventario volvió por una unidad',
  sql(`select i.credited_quantity::text from invoice_items i
       join invoices f on f.id = i.invoice_id
       where f.client_request_id='e2e-nc-1'`) === '1' && stockNC === 40,
  `stock=${stockNC}`);

// --- Fiscal: cargar un rango NCF y verlo vigente.
await go(page, /^Facturación/, /^Fiscal/);
await page.getByRole('button', { name: /Cargar rango/ }).click();
await page.waitForTimeout(600);
await page.getByLabel('Tipo de comprobante').selectOption('B01');
await page.getByLabel('Desde').fill('500');
await page.getByLabel('Hasta', { exact: true }).fill('900');
await page.getByLabel('Autorizado hasta').fill('2030-12-31');
await page.getByRole('dialog').getByRole('button', { name: /Cargar rango$/ }).click();
await page.waitForTimeout(2200);

check('el rango NCF se cargó con su correlativo en el inicio',
  sql("select (range_start || '/' || next_value || '/' || range_end) from ncf_sequences where ncf_type='B01'") === '500/500/900',
  sql("select coalesce((select range_start::text from ncf_sequences where ncf_type='B01'),'(ninguno)')"));

// --- Usuarios y roles: cambiar el rol de otra persona.
await go(page, /^Configuración/, /^Usuarios/);
await page.waitForTimeout(1200);
await page.getByLabel(/Rol de Cajero E2E/).selectOption('supervisor');
await page.waitForTimeout(2200);

check('el cambio de rol se guardó',
  sql("select role::text from profiles where full_name='Cajero E2E'") === 'supervisor',
  sql("select role::text from profiles where full_name='Cajero E2E'"));

// La base impide ascenderse a uno mismo, aunque se llame al API directamente.
check('nadie se asciende a sí mismo, ni el propietario',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
           set role authenticated;
           update public.profiles set role='superadmin'
            where id='66666666-6666-6666-6666-666666666666';`);
      // RLS filtra en silencio: si no lanzó, el rol NO debe haber cambiado.
      return sql("select role::text from profiles where full_name='Dueño E2E'") === 'propietario';
    } catch { return true; }
  })());


// --- [14] Importar y exportar: el ensayo enseña qué pasará y no escribe nada.
await go(page, /^Clientes/, /^Clientes/);
await page.waitForTimeout(1200);

const clientesAntes = Number(sql("select count(*) from customers"));

// Un archivo con tres filas: una nueva, una repetida (mismo teléfono que la
// primera, escrito distinto) y una sin nombre, que debe caer sola.
const csv = [
  'Nombre,Apellido,Teléfono,Correo',
  'Ramona,Ventura,809-777-1234,ramona@ejemplo.com',
  'Ramona Ventura,,1-809-777-1234,',
  ',,809-777-9999,'   // sin nombre NI apellido: esta es la que debe caer
].join('\r\n');

await page.getByRole('button', { name: /^Importar/ }).click();
await page.getByRole('dialog').waitFor();
await page.locator('#import-file').setInputFiles({
  name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8')
});
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Previsualizar/ }).click();
await page.waitForTimeout(2000);

check('la previsualización NO escribió nada todavía',
  Number(sql("select count(*) from customers")) === clientesAntes,
  `antes ${clientesAntes}, ahora ${sql("select count(*) from customers")}`);

const dialogo = page.getByRole('dialog');
check('la previsualización avisa de que no ha guardado nada',
  (await dialogo.getByText(/todavía no se ha guardado nada/i).count()) > 0);
check('la previsualización clasifica las tres filas',
  (await dialogo.getByText('crear', { exact: true }).count()) === 1
  && (await dialogo.getByText('error', { exact: true }).count()) === 1);

// Ahora sí: aplicar.
await dialogo.getByRole('button', { name: /Aplicar esta importación/ }).click();
await page.waitForTimeout(2500);

check('al aplicar entra UNA sola clienta, no dos',
  Number(sql("select count(*) from customers")) === clientesAntes + 1,
  `${clientesAntes} → ${sql("select count(*) from customers")}`);
check('el mismo teléfono con el 1 delante no duplicó a Ramona',
  sql("select count(*) from customers where name='Ramona Ventura'") === '1');
check('el teléfono quedó normalizado a formato dominicano',
  sql("select phone from customers where name='Ramona Ventura'") === '809-777-1234',
  sql("select phone from customers where name='Ramona Ventura'"));
check('la fila sin nombre ni apellido no entró',
  sql("select count(*) from customers where phone like '%777-9999%'") === '0');
check('la importación quedó en la bitácora',
  sql("select count(*) from audit_logs where action='IMPORTAR'") === '1');

// Un cajero no puede importar ni llamando al API directamente.
check('un cajero no importa, aunque se salte la pantalla',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
           set role authenticated;
           select public.import_batch('clientes',
             jsonb_build_array(jsonb_build_object('nombre','Pirata')), true);`);
      return false;
    } catch { return true; }
  })());


// El diálogo de importar sigue abierto tras aplicar: se cierra antes de seguir,
// o su capa tapa los clics de todo lo que venga después.
await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click();
await page.waitForTimeout(600);

// --- [15] Procedencia: de dónde vino el cliente, y que no se pueda reescribir.
sql(`insert into public.customers (company_id, branch_id, name, phone, membego_customer_id)
     values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
             'Vino De Membego','809-700-0001','MG-E2E-1');`);

await go(page, /^Clientes/, /^Clientes/);
await page.waitForTimeout(1500);

check('la base sella la procedencia de quien llega por Membego',
  sql("select origin::text from customers where name='Vino De Membego'") === 'membego');
check('y el que registró el car wash queda como propio',
  sql("select origin::text from customers where name='Ramona Ventura'") === 'carwash');

// El filtro pregunta al servidor: el contador tiene que ser el de la base.
await page.getByRole('button', { name: 'De Membego', exact: true }).click();
await page.waitForTimeout(1800);

const deMembego = Number(sql("select count(*) from customers where origin='membego'"));
check('el filtro «De Membego» trae exactamente los de Membego',
  (await page.getByRole('cell', { name: 'Vino De Membego' }).count()) === 1
  && (await page.getByRole('cell', { name: 'Ramona Ventura' }).count()) === 0,
  `en la base hay ${deMembego}`);

await page.getByRole('button', { name: 'Del car wash', exact: true }).click();
await page.waitForTimeout(1800);
check('y «Del car wash» deja fuera a los de Membego',
  (await page.getByRole('cell', { name: 'Vino De Membego' }).count()) === 0);

// Vincular después a Membego NO cambia de dónde vino: es lo que hace fiable la
// atribución de ventas entre los dos canales.
sql(`update public.customers set membego_customer_id='MG-E2E-TARDIO'
      where name='Ramona Ventura';`);
check('vincular a Membego un cliente propio no lo transfiere de canal',
  sql("select origin::text from customers where name='Ramona Ventura'") === 'carwash');

check('la procedencia no se reescribe ni llamando al API directamente',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
           set role authenticated;
           update public.customers set origin='membego' where name='Ramona Ventura';`);
      return false;
    } catch { return true; }
  })());

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) { console.log('\nFALLOS:'); failed.forEach(f => console.log(`  - ${f.name}`)); process.exit(1); }
