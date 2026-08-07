/**
 * Ensayo de extremo a extremo de la vista de Facturas, contra la pila real:
 * navegador -> supabase-js -> PostgREST -> PostgreSQL con RLS.
 *
 * Requiere la base reiniciada (`tests/e2e/reset.sh`), el proxy en el 3002 y la
 * aplicación servida en el 4174.
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

/** Emite facturas de partida usando el propio RPC, como cajero autenticado. */
function seedInvoices(count) {
  sql(`
    set role postgres;
    insert into public.cash_sessions (company_id, branch_id, cashier_id, initial_amount_cents)
    values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
            '33333333-3333-3333-3333-333333333333', 300000)
    on conflict do nothing;
  `);
  for (let i = 1; i <= count; i++) {
    sql(`
      select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
      set role authenticated;
      select public.create_invoice(
        '22222222-2222-2222-2222-222222222222'::uuid,
        'seed-${i}',
        jsonb_build_array(jsonb_build_object(
          'item_type','product','product_id','55555555-5555-5555-5555-555555555555',
          'name','Aromatizante','quantity',1,'discount_cents',0,'is_membego_covered',false)),
        jsonb_build_array(jsonb_build_object('method','tarjeta','amount_cents',29500)),
        'sedan', null, null, 'Cliente ${i}', null, 'PL${String(i).padStart(4,'0')}', 'B02',
        (select id from public.cash_sessions where status='open' limit 1)
      );
    `);
  }
}

async function login(page, email) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill('clave-de-prueba');
  await page.getByRole('button', { name: /Entrar/ }).click();
  const modFacturacion = page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Facturación' });
  await modFacturacion.waitFor({ timeout: 15000 });
  await modFacturacion.click();
  await page.waitForTimeout(1800);
}

// 30 comprobantes: más de una página de 25, para que la paginación signifique algo.
seedInvoices(30);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

// ====================================================== Cajero (sin permiso)
console.log('\n[1] Vista de facturas — cajero');
let ctx = await browser.newContext();
let page = await ctx.newPage();
await login(page, 'cajero@example.com');

// Orden descendente por fecha: la primera página trae los comprobantes más
// recientes, no el número 1.
check('el historial carga desde la base de datos',
  await page.getByText('FAC-00000030').isVisible().catch(() => false));

const shown = await page.locator('tbody tr').count();
check('la tabla está paginada: no vuelca las 30 filas de golpe',
  shown === 25, `${shown} filas en pantalla de ${sql('select count(*) from invoices')} totales`);

check('el pie indica el rango y el total',
  (await page.getByText(/Mostrando 1–25 de 30/).isVisible().catch(() => false)));

check('el botón de anular está deshabilitado para el cajero',
  await page.getByRole('button', { name: /Anular/ }).first().isDisabled().catch(() => false));

// Búsqueda en servidor
await page.getByLabel('Buscar comprobante').fill('PL0007');
await page.waitForTimeout(1200);
const filtered = await page.locator('tbody tr').count();
check('la búsqueda filtra en el servidor',
  filtered === 1 && await page.getByText('PL0007').isVisible().catch(() => false),
  `${filtered} fila(s)`);

await page.getByLabel('Buscar comprobante').fill('');
await page.waitForTimeout(1200);

// Paginación
await page.getByLabel('Página siguiente').click();
await page.waitForTimeout(1200);
check('la segunda página trae las filas restantes',
  (await page.locator('tbody tr').count()) === 5,
  `${await page.locator('tbody tr').count()} filas`);
await page.getByLabel('Página anterior').click();
await page.waitForTimeout(1200);

// ------------------------------------------------------------ Ticket e impresión
console.log('\n[2] Comprobante e impresión térmica');
await page.getByRole('button', { name: /Ticket/ }).first().click();
await page.waitForTimeout(1500);

check('el detalle del comprobante se lee de la base',
  await page.getByText('1x Aromatizante').isVisible().catch(() => false));
check('el modal es un diálogo accesible',
  await page.locator('[role="dialog"][aria-modal="true"]').count() > 0);

// Cierre con Escape: los modales auditados no lo soportaban.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('el modal se cierra con Escape',
  (await page.locator('[role="dialog"]').count()) === 0);

await page.getByRole('button', { name: /Ticket/ }).first().click();
await page.waitForTimeout(1500);

// La prueba del arreglo de impresión: en medio `print`, solo el ticket debe
// quedar visible. Antes se imprimía el panel completo con fondo oscuro.
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(400);

const printState = await page.evaluate(() => {
  const ticket = document.querySelector('.print-ticket');
  const sidebar = document.querySelector('aside');
  const header = document.querySelector('header');
  const vis = (el) => (el ? getComputedStyle(el).visibility : 'ausente');
  return {
    ticket: vis(ticket),
    sidebar: vis(sidebar),
    header: vis(header),
    ticketPosition: ticket ? getComputedStyle(ticket).position : 'ausente',
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
});

check('al imprimir, el ticket es lo único visible',
  printState.ticket === 'visible' && printState.sidebar === 'hidden' && printState.header === 'hidden',
  `ticket=${printState.ticket} barra=${printState.sidebar} cabecera=${printState.header}`);
check('el ticket se ancla a la esquina del papel',
  printState.ticketPosition === 'absolute', printState.ticketPosition);
check('el fondo de impresión es blanco, no el tema oscuro',
  printState.bodyBg === 'rgb(255, 255, 255)', printState.bodyBg);

await page.emulateMedia({ media: 'screen' });
await page.keyboard.press('Escape');
await ctx.close();

// ====================================================== Propietario (con permiso)
console.log('\n[3] Anulación con nota de crédito — propietario');
ctx = await browser.newContext();
page = await ctx.newPage();
await login(page, 'dueno@example.com');

// La lista ordena por fecha descendente: el primer botón «Anular» actúa sobre
// el comprobante MÁS RECIENTE.
const target = sql("select invoice_number from invoices order by created_at desc limit 1");
const stockBefore = Number(sql("select stock from products where code='AR1'"));
const cashBefore = Number(sql("select expected_cash_cents from cash_sessions where status='open'"));
const invoicesBefore = Number(sql('select count(*) from invoices'));

check('el propietario sí tiene habilitado el botón de anular',
  !(await page.getByRole('button', { name: /Anular/ }).first().isDisabled().catch(() => true)));

await page.getByRole('button', { name: /Anular/ }).first().click();
await page.waitForTimeout(600);

check('la anulación pide confirmación y explica lo que hará',
  await page.getByText(/nota de crédito B04/).isVisible().catch(() => false));

check('no se puede confirmar sin motivo',
  await page.getByRole('button', { name: /Anular y emitir nota/ }).isDisabled().catch(() => false));

await page.getByLabel(/Motivo de la anulación/).fill('abc');
await page.waitForTimeout(300);
check('un motivo demasiado corto no habilita la acción',
  await page.getByRole('button', { name: /Anular y emitir nota/ }).isDisabled().catch(() => false));

await page.getByLabel(/Motivo de la anulación/).fill('Cobro duplicado al cliente');
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Anular y emitir nota/ }).click();
await page.waitForTimeout(2800);

check('se emitió la nota de crédito',
  Number(sql('select count(*) from invoices')) === invoicesBefore + 1);
check('la nota de crédito es de tipo B04 y apunta al original',
  sql("select ncf_type from invoices where credits_invoice_id is not null order by created_at desc limit 1") === 'B04'
  && sql("select ncf from invoices where credits_invoice_id is not null order by created_at desc limit 1").startsWith('B04'),
  sql("select coalesce(ncf,'(nulo)') from invoices where credits_invoice_id is not null order by created_at desc limit 1"));
check('la factura original queda anulada con motivo y autor',
  sql(`select is_annulled from invoices where invoice_number='${target}'`) === 't'
  && sql(`select annulled_reason from invoices where invoice_number='${target}'`) === 'Cobro duplicado al cliente'
  && sql(`select annulled_by from invoices where invoice_number='${target}'`) === '66666666-6666-6666-6666-666666666666');
check('el inventario se devolvió',
  Number(sql("select stock from products where code='AR1'")) === stockBefore + 1,
  `${stockBefore} → ${sql("select stock from products where code='AR1'")}`);
check('la caja registró la devolución como asiento compensatorio',
  Number(sql("select count(*) from cash_movements where type='outflow'")) === 1
  && Number(sql("select expected_cash_cents from cash_sessions where status='open'")) === cashBefore,
  `la venta fue con tarjeta: el efectivo no cambia (${cashBefore})`);
check('la anulación quedó en la bitácora',
  Number(sql("select count(*) from audit_logs where action='ANULAR_FACTURA'")) === 1);
check('la interfaz confirma la anulación al usuario',
  await page.getByText(/anulada. Nota de crédito/).isVisible().catch(() => false));
check('la fila aparece marcada como anulada',
  await page.getByText('ANULADA').first().isVisible().catch(() => false));

// El filtro de notas de crédito.
await page.getByRole('button', { name: 'Notas de crédito', exact: true }).click();
await page.waitForTimeout(1200);
check('el filtro de notas de crédito las aísla',
  (await page.locator('tbody tr').count()) === 1
  && await page.getByText('NOTA DE CRÉDITO').first().isVisible().catch(() => false),
  `${await page.locator('tbody tr').count()} fila(s)`);

// Reanular la misma factura debe quedar bloqueado.
await page.getByRole('button', { name: 'Todos', exact: true }).click();
await page.waitForTimeout(1200);
const annulButtons = await page.getByRole('button', { name: /Anular/ }).count();
const annulledRows = Number(sql('select count(*) from invoices where is_annulled'));
check('una factura ya anulada no ofrece anularse otra vez',
  annulButtons === 25 - annulledRows - 1,  // -1: la nota de crédito tampoco se anula
  `${annulButtons} botones visibles en la página`);

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) { console.log('\nFALLOS:'); failed.forEach(f => console.log(`  - ${f.name}`)); process.exit(1); }
