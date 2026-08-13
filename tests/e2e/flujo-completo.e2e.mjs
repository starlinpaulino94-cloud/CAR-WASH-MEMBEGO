/**
 * EL RECORRIDO COMPLETO: del momento en que el cliente entra al car wash hasta
 * que paga y se lleva su factura.
 *
 * Los otros cuatro ensayos prueban módulos. Este prueba el NEGOCIO: hace el
 * viaje entero por la interfaz real, en orden, como lo haría el personal en un
 * día normal, y después de cada paso pregunta a PostgreSQL qué quedó escrito.
 *
 * Existe porque un sistema puede tener todas sus piezas funcionando y aun así
 * no servir: basta con que dos de ellas no se hablen. Eso no lo detecta ninguna
 * prueba de módulo — solo se ve al recorrer el camino entero.
 *
 * ESTE ENSAYO FALLA A PROPÓSITO mientras el flujo esté roto. No es inestable ni
 * está a medias: cada fallo es un hueco real, medido, con el dato que lo prueba.
 * El día que se cierren, se pone verde solo y a partir de ahí vigila que no se
 * vuelvan a abrir.
 *
 * Requiere `tests/e2e/reset.sh`, el proxy en el 3002 y la aplicación en el 4174.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = 'http://127.0.0.1:4174/';
const results = [];
const paso = (n, titulo) => console.log(`\n── ${n}. ${titulo}`);
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASA ' : 'FALLA'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

const sql = (q) =>
  execFileSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'membego_e2e', '-tA', '-c', q])
    .toString().trim();

const EMPRESA  = '11111111-1111-1111-1111-111111111111';
const SUCURSAL = '22222222-2222-2222-2222-222222222222';
const CAJERO   = '33333333-3333-3333-3333-333333333333';
const SERVICIO = '44444444-4444-4444-4444-444444444444';
const PRODUCTO = '55555555-5555-5555-5555-555555555555';

const OPERARIO = '77777777-7777-7777-7777-777777777777';

// Una bahía donde lavar y un operario a quien pagarle la comisión. Sin operario
// el lavado se puede entregar igual, pero no genera comisión — y entonces esta
// comprobación pasaría por no haber nada que comprobar.
sql(`
  insert into public.bays (company_id, branch_id, name, type, status)
    values ('${EMPRESA}','${SUCURSAL}','Bahía 1','lavado','disponible');
  insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values ('${EMPRESA}','${SUCURSAL}','${CAJERO}', 500000);
  insert into auth.users (id, email) values ('${OPERARIO}','operario@example.com')
    on conflict (id) do nothing;
`);
// La sucursal de un empleado la protege un guardia desde 0031: el alta declara
// el contexto igual que hace create_employee().
sql(`do $$
begin
  perform set_config('app.branch_ctx', 'ok', true);
  perform set_config('app.payroll_ctx', 'ok', true);
  update public.profiles
     set company_id='${EMPRESA}', branch_id='${SUCURSAL}',
         role='operario', full_name='Operario Flujo', commission_bps=1000
   where id='${OPERARIO}';
  perform set_config('app.branch_ctx', '', true);
  perform set_config('app.payroll_ctx', '', true);
end $$;`);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByLabel('Correo electrónico').fill('cajero@example.com');
await page.getByLabel('Contraseña').fill('clave-de-prueba');
await page.getByRole('button', { name: /Entrar/ }).click();
await page.locator('nav[aria-label="Módulos"]').waitFor({ timeout: 15000 });

const go = async (modulo, submodulo) => {
  await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: modulo }).click();
  await page.waitForTimeout(700);
  if (submodulo) {
    await page.locator('nav[aria-label="Submódulos"]').getByRole('link', { name: submodulo }).click();
    await page.waitForTimeout(1400);
  }
};

// =========================================================================
paso(1, 'Llega el cliente: se registra la entrada del vehículo');
// =========================================================================
await go(/^Operaciones/, /^Órdenes/);
await page.getByRole('button', { name: /Registrar llegada/ }).click();
await page.getByRole('dialog').waitFor();

const dlg = page.getByRole('dialog');
await dlg.getByLabel(/Placa/i).fill('FLU-1234');
await page.waitForTimeout(400);
// El servicio del catálogo que se le va a hacer.
const chipServicio = dlg.getByRole('button', { name: /Lavado/ }).first();
if (await chipServicio.count()) await chipServicio.click();
const campoCliente = dlg.getByLabel(/Cliente|Nombre/i).first();
if (await campoCliente.count()) await campoCliente.fill('Cliente Del Flujo');
await page.waitForTimeout(300);
await dlg.getByRole('button', { name: /Registrar|Guardar|Crear/ }).last().click();
await page.waitForTimeout(2500);

const ordenId = sql("select id from work_orders where vehicle_plate='FLU1234' limit 1");
check('la llegada crea una orden de trabajo', ordenId.length === 36, ordenId || 'sin orden');
check('la placa se normaliza al guardar',
  sql("select vehicle_plate from work_orders where id='" + ordenId + "'") === 'FLU1234');
check('la orden nace pendiente',
  sql(`select status::text from work_orders where id='${ordenId}'`) === 'pendiente');
check('la orden nace SIN pagar',
  sql(`select payment_status::text from work_orders where id='${ordenId}'`) === 'pendiente');
check('el vehículo queda registrado en la flotilla del cliente',
  sql("select count(*) from vehicles where plate='FLU1234'") === '1');
const totalOrden = sql(`select total_cents from work_orders where id='${ordenId}'`);
check('la orden lleva importe calculado por el servidor',
  Number(totalOrden) > 0, `${totalOrden} centavos`);

// =========================================================================
paso(2, 'Empieza el lavado: se asigna bahía');
// =========================================================================
await go(/^Operaciones/, /^Cola/);
await page.waitForTimeout(1500);

const tarjeta = page.locator('article, [data-order], li').filter({ hasText: 'FLU1234' }).first();
const hayTarjeta = await tarjeta.count() > 0;
check('la orden aparece en la cola de trabajo', hayTarjeta);

// Se inicia por la pantalla, no por el RPC: es ahí donde se elige la bahía y
// SE ASIGNA EL OPERARIO, y sin operario asignado no hay comisión que pagar.
const btnIniciar = page.getByRole('button', { name: /Iniciar lavado|Iniciar/ }).first();
check('la cola ofrece iniciar el lavado', (await btnIniciar.count()) > 0);
await btnIniciar.click();
const dlgInicio = page.getByRole('dialog', { name: /Iniciar lavado/ });
await dlgInicio.waitFor({ timeout: 8000 });
await dlgInicio.getByLabel(/Bahía/i).selectOption({ index: 1 }).catch(() => {});
// El operario que lava: es a quien se le paga la comisión al entregar.
const chipOperario = dlgInicio.getByRole('button').filter({ hasText: /Operario Flujo/ }).first();
if (await chipOperario.count()) await chipOperario.click();
await dlgInicio.getByRole('button', { name: /Iniciar|Confirmar|Comenzar/ }).last().click();
await page.waitForTimeout(2500);

check('al iniciar el lavado la orden pasa a en proceso',
  sql(`select status::text from work_orders where id='${ordenId}'`) === 'en_proceso');
check('la bahía queda ocupada por ESA orden',
  sql(`select current_work_order_id from bays where name='Bahía 1'`) === ordenId);
check('la base exige bahía para iniciar el lavado',
  (() => {
    try {
      sql(`select set_config('request.jwt.claim.sub','${CAJERO}',false);
           set role authenticated;
           select public.advance_work_order('${ordenId}','en_proceso', null, null);`);
      return false;
    } catch { return true; }
  })());

// =========================================================================
paso(3, 'Termina el lavado: control de calidad y listo para entregar');
// =========================================================================
sql(`select set_config('request.jwt.claim.sub','${CAJERO}',false);
     set role authenticated;
     select public.advance_work_order('${ordenId}','control_calidad', null, null);
     select public.advance_work_order('${ordenId}','listo', null, null);`);

check('la orden queda lista para entregar',
  sql(`select status::text from work_orders where id='${ordenId}'`) === 'listo');
check('la bahía se libera sola al salir el vehículo',
  sql(`select coalesce(current_work_order_id::text,'libre') from bays where name='Bahía 1'`) === 'libre');
check('se encola el aviso al cliente de que su vehículo está listo',
  sql(`select count(*) from notifications where kind='orden_lista'
       and body like '%FLU1234%'`) !== '0',
  sql(`select coalesce(string_agg(kind::text,','),'ninguno') from notifications`));

// =========================================================================
paso(4, 'El cliente paga: se cobra la orden en el punto de venta');
// =========================================================================
await go(/^Ventas/, /^Punto de venta/);
await page.waitForTimeout(1800);

// ¿Ofrece la pantalla cobrar una orden que ya existe?
const buscadorOrden = page.getByRole('textbox', { name: /orden|placa pendiente|cobrar orden/i });
const listaPendientes = page.getByText(/órdenes? (pendientes?|por cobrar|sin cobrar)/i);
const puedeCobrarLaOrden =
  (await buscadorOrden.count()) > 0 || (await listaPendientes.count()) > 0;

check('el punto de venta permite cobrar una orden ya registrada',
  puedeCobrarLaOrden,
  puedeCobrarLaOrden ? '' : 'no hay forma de traer la orden al cobro');

// Se cobra como se puede: tecleando la venta de nuevo.
await page.getByRole('button', { name: /Lavado/ }).first().click();
await page.waitForTimeout(600);
const placaPos = page.getByLabel(/Placa/i).first();
if (await placaPos.count()) await placaPos.fill('FLU-1234');
const nombrePos = page.getByLabel(/Cliente/i).first();
if (await nombrePos.count()) await nombrePos.fill('Cliente Del Flujo');

// El cliente pide factura con NCF: es una casilla, y por omisión va apagada.
const casillaNcf = page.getByLabel(/comprobante fiscal/i);
check('el punto de venta ofrece emitir comprobante fiscal',
  (await casillaNcf.count()) > 0);
if (await casillaNcf.count()) { await casillaNcf.check(); await page.waitForTimeout(500); }

const totalTexto = await page.getByText(/RD\$/).last().innerText().catch(() => '');
await page.getByLabel(/Recibido|Efectivo|Monto/i).first().fill('5000').catch(() => {});
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^Cobrar/ }).click();
await page.waitForTimeout(3000);

const factura = sql("select id from invoices order by created_at desc limit 1");
check('la venta emite una factura', factura.length === 36, totalTexto);
check('la factura lleva NCF fiscal',
  sql(`select coalesce(ncf,'sin ncf') from invoices where id='${factura}'`) !== 'sin ncf',
  sql(`select coalesce(ncf,'sin ncf') from invoices where id='${factura}'`));
check('el efectivo entra a la caja',
  sql(`select count(*) from cash_movements where invoice_id='${factura}' and type='inflow'`) !== '0');

// LO QUE IMPORTA: ¿quedó la orden pagada?
const pagoOrden = sql(`select payment_status::text from work_orders where id='${ordenId}'`);
check('la orden del cliente queda marcada como PAGADA',
  pagoOrden === 'pagado', `payment_status = ${pagoOrden}`);
// El cobro identifica al cliente por NOMBRE ESCRITO A MANO, no por su ficha.
check('la factura queda enlazada a la ficha del cliente',
  sql(`select count(*) from invoices where id='${factura}' and customer_id is not null`) === '1',
  'la factura guarda el nombre como texto, sin apuntar al cliente');

// Y sin ficha de cliente no se puede fiar: la base lo exige, con razón.
const metodos = await page.getByRole('button', { name: /Efectivo|Tarjeta|Transfer|Crédito/ }).allInnerTexts();
check('el punto de venta permite fiar a un cliente con cupo',
  metodos.some(t => /cr[ée]dito/i.test(t)),
  `formas de pago ofrecidas: ${metodos.join(', ')}`);

check('la factura queda enlazada a la orden que se lavó',
  sql(`select coalesce(work_order_id::text,'sin enlace') from invoices where id='${factura}'`) === ordenId,
  sql(`select coalesce(work_order_id::text,'sin enlace') from invoices where id='${factura}'`));

// =========================================================================
paso(5, 'Se entrega el vehículo y se paga la comisión al operario');
// =========================================================================
sql(`select set_config('request.jwt.claim.sub','${CAJERO}',false);
     set role authenticated;
     select public.advance_work_order('${ordenId}','entregado', null, null);`);

check('la orden queda entregada',
  sql(`select status::text from work_orders where id='${ordenId}'`) === 'entregado');
check('se genera la comisión del lavado',
  sql(`select count(*) from commissions where work_order_id='${ordenId}'`) !== '0',
  sql(`select coalesce(sum(amount_cents)::text,'0') from commissions where work_order_id='${ordenId}'`));

// =========================================================================
paso(6, 'El cliente se lleva su factura: reimpresión');
// =========================================================================
await go(/^Facturación/, /^Facturas/);
await page.waitForTimeout(2000);

const ncf = sql(`select ncf from invoices where id='${factura}'`);
check('la factura aparece en el listado con su NCF',
  (await page.getByText(ncf).count()) > 0, ncf);

const verTicket = page.getByRole('button', { name: /Ticket|Imprimir|Ver/i }).first();
if (await verTicket.count()) {
  await verTicket.click();
  await page.waitForTimeout(1200);
  const modal = page.getByRole('dialog');
  check('se puede reimprimir el comprobante para el cliente',
    (await modal.count()) > 0 && (await modal.getByText(ncf).count()) > 0);
} else {
  check('se puede reimprimir el comprobante para el cliente', false, 'sin botón de ticket');
}

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(64)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) {
  console.log('\nDONDE SE ROMPE EL FLUJO:');
  failed.forEach(f => console.log(`  ✗ ${f.name}${f.detail ? `  → ${f.detail}` : ''}`));
  process.exit(1);
}
