/**
 * Ensayo de extremo a extremo de las vistas migradas de POS y Caja,
 * contra la pila real: navegador -> supabase-js -> PostgREST -> PostgreSQL con RLS.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = 'http://127.0.0.1:4174/';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASA ' : 'FALLA'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

/** Consulta la base directamente para comprobar lo que de verdad quedó escrito. */
const sql = (q) =>
  execFileSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'membego_e2e', '-tA', '-c', q])
    .toString().trim();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('    [consola]', m.text().slice(0, 140)); });

// ------------------------------------------------------------------ Acceso
console.log('\n[1] Autenticación real');
await page.goto(URL, { waitUntil: 'networkidle' });
check('sin sesión se muestra la pantalla de acceso',
  await page.getByRole('button', { name: /Entrar/ }).isVisible().catch(() => false));
check('no se llega a la aplicación sin autenticarse',
  !(await page.getByText('Punto de Venta').isVisible().catch(() => false)));

await page.getByLabel('Correo electrónico').fill('cajero@example.com');
await page.getByLabel('Contraseña').fill('mal');
await page.getByRole('button', { name: /Entrar/ }).click();
await page.waitForTimeout(900);
check('una contraseña incorrecta no da acceso',
  await page.getByRole('button', { name: /Entrar/ }).isVisible().catch(() => false));

await page.getByLabel('Contraseña').fill('clave-de-prueba');
await page.getByRole('button', { name: /Entrar/ }).click();
const sidebarPos = page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Ventas' });
await sidebarPos.waitFor({ timeout: 15000 }).catch(() => {});
check('con credenciales válidas se entra a la aplicación',
  await sidebarPos.isVisible().catch(() => false));
check('la barra muestra la identidad REAL, no un selector de rol',
  (await page.locator('header').innerText()).includes('Cajero E2E')
  && await page.getByLabel('Cerrar sesión').isVisible().catch(() => false),
  (await page.locator('header').innerText()).replace(/\n/g, ' ').slice(0, 90));

// -------------------------------------------------------------------- Caja
console.log('\n[2] Caja — apertura');
await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Caja' }).click();
await page.waitForTimeout(1500);
check('la caja aparece cerrada al inicio',
  await page.getByText('Apertura de turno').isVisible().catch(() => false));

await page.getByLabel(/Fondo inicial/).fill('3000');
await page.getByRole('button', { name: /Abrir caja/ }).click();
await page.waitForTimeout(1800);

check('la sesión de caja se creó en la base de datos',
  sql("select count(*) from cash_sessions where status='open'") === '1');
check('el fondo inicial se guardó en CENTAVOS, no en pesos',
  sql("select initial_amount_cents from cash_sessions where status='open'") === '300000',
  `${sql("select initial_amount_cents from cash_sessions where status='open'")} centavos`);
check('el arqueo esperado NO se muestra mientras se cuenta',
  await page.getByText('••••••').isVisible().catch(() => false));

// --------------------------------------------------------------------- POS
console.log('\n[3] POS — emisión de factura');
await sidebarPos.click();
await page.waitForTimeout(1800);

check('el catálogo llega desde la base de datos',
  await page.getByRole('button', { name: /Lavado Completo/ }).isVisible().catch(() => false));
check('los precios se muestran con decimales, no como enteros de pesos',
  (await page.getByRole('button', { name: /Lavado Completo/ }).innerText()).includes('1,000.00'),
  (await page.getByRole('button', { name: /Lavado Completo/ }).innerText()).replace(/\n/g, ' '));

await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.getByRole('tab', { name: 'Productos' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Aromatizante/ }).click();
await page.getByRole('button', { name: /Añadir uno de Aromatizante/ }).click();
await page.waitForTimeout(300);

// 1000,00 + 2x250,00 = 1500,00 ; ITBIS 18% = 270,00 ; total 1770,00
check('la previsualización del total coincide con la fórmula del servidor',
  (await page.getByRole('button', { name: /Cobrar/ }).innerText()).includes('1,770.00'),
  (await page.getByRole('button', { name: /Cobrar/ }).innerText()));

await page.getByLabel('Cliente').fill('Cliente E2E');
await page.getByLabel('Placa').fill('e2e001');
await page.getByLabel('Recibido').fill('2000');
await page.getByText('Emitir comprobante fiscal (NCF)').click();
await page.waitForTimeout(300);

const invoicesBefore = Number(sql('select count(*) from invoices'));
await page.getByRole('button', { name: /Cobrar/ }).click();
await page.waitForTimeout(2500);

check('la factura se emitió',
  Number(sql('select count(*) from invoices')) === invoicesBefore + 1);
check('el total quedó en centavos exactos',
  sql('select total_cents from invoices order by created_at desc limit 1') === '177000',
  sql('select total_cents from invoices order by created_at desc limit 1'));
check('se asignó un NCF correlativo de la DGII',
  sql("select ncf from invoices order by created_at desc limit 1") === 'B0200000001',
  sql("select coalesce(ncf,'(nulo)') from invoices order by created_at desc limit 1"));
check('el cambio se calculó una sola vez',
  sql('select change_cents from invoices order by created_at desc limit 1') === '23000',
  sql('select change_cents from invoices order by created_at desc limit 1'));
check('el inventario se descontó',
  sql("select stock from products where code='AR1'") === '8',
  `${sql("select stock from products where code='AR1'")} unidades`);
check('la caja recibió el efectivo NETO del cambio',
  sql("select expected_cash_cents from cash_sessions where status='open'") === '477000',
  sql("select expected_cash_cents from cash_sessions where status='open'"));
check('la operación quedó en la bitácora de auditoría',
  sql("select count(*) from audit_logs where action='EMITIR_FACTURA'") === '1');
check('el actor de la bitácora es el usuario autenticado',
  sql("select actor_name from audit_logs where action='EMITIR_FACTURA'") === 'Cajero E2E',
  sql("select coalesce(actor_name,'(nulo)') from audit_logs where action='EMITIR_FACTURA'"));
check('la interfaz confirma la emisión al cajero',
  await page.getByText(/Emitida FAC-/).isVisible().catch(() => false));

// ------------------------------------------------------- Doble clic (idempotencia)
console.log('\n[4] POS — protección contra doble cobro');
await page.getByRole('button', { name: /Lavado Completo/ }).isVisible().catch(() => {});
await page.getByRole('tab', { name: 'Servicios' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Lavado Completo/ }).click();
await page.getByLabel('Recibido').fill('1180');
await page.waitForTimeout(200);

const beforeDouble = Number(sql('select count(*) from invoices'));
// Dos clics inmediatos, como haría un cajero impaciente.
const cobrar = page.getByRole('button', { name: /Cobrar/ });
await cobrar.click();
await cobrar.click({ force: true }).catch(() => {});
await page.waitForTimeout(2500);

check('el doble clic no emitió dos facturas',
  Number(sql('select count(*) from invoices')) === beforeDouble + 1,
  `antes=${beforeDouble} después=${sql('select count(*) from invoices')}`);

// ------------------------------------------------------------ Permisos (RLS)
console.log('\n[5] Autorización aplicada por la base de datos');
const invId = sql('select id from invoices order by created_at desc limit 1');
const token = await page.evaluate(() => {
  const raw = localStorage.getItem('membego_cw_auth');
  return raw ? JSON.parse(raw).access_token : null;
});
const annul = await page.evaluate(async ([id, tk]) => {
  const r = await fetch('http://127.0.0.1:3002/rest/v1/rpc/annul_invoice', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tk}` },
    body: JSON.stringify({ p_invoice_id: id, p_reason: 'intento del cajero', p_client_request_id: 'e2e-anul-1' })
  });
  return { status: r.status, body: (await r.text()).slice(0, 160) };
}, [invId, token]);

check('un cajero NO puede anular, ni llamando al API directamente',
  annul.status >= 400, `HTTP ${annul.status}`);
check('la factura sigue vigente tras el intento',
  sql(`select is_annulled from invoices where id='${invId}'`) === 'f');

// ------------------------------------------------------------- Cierre de caja
console.log('\n[6] Caja — arqueo y cierre');
await page.locator('nav[aria-label="Módulos"]').getByRole('link', { name: 'Caja' }).click();
await page.waitForTimeout(1800);

check('los movimientos del turno se listan',
  await page.getByText(/Movimientos del turno/).isVisible().catch(() => false));

const expected = sql("select expected_cash_cents from cash_sessions where status='open'");
await page.getByLabel(/Efectivo contado/).fill('5000');
await page.getByRole('button', { name: /Cerrar turno/ }).click();
await page.waitForTimeout(2000);

check('la caja quedó cerrada en la base de datos',
  sql("select count(*) from cash_sessions where status='closed'") === '1');
check('el descuadre se calculó y guardó',
  sql('select difference_cents from cash_sessions where status=\'closed\'') === String(500000 - Number(expected)),
  `contado 500000 − esperado ${expected} = ${sql("select difference_cents from cash_sessions where status='closed'")}`);
check('el histórico conserva el turno cerrado (antes se sobrescribía)',
  await page.getByText(/Turnos anteriores/).isVisible().catch(() => false));

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${'='.repeat(62)}`);
console.log(`RESULTADO: ${results.length - failed.length}/${results.length} comprobaciones pasan`);
if (failed.length) { console.log('\nFALLOS:'); failed.forEach(f => console.log(`  - ${f.name}`)); process.exit(1); }
