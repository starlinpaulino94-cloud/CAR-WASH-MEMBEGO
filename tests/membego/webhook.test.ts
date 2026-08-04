import { createHmac } from 'node:crypto';

process.env.MEMBEGO_SECRETO = 'test-secret-abc';
process.env.SUPABASE_URL = 'http://supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-key';

const { POST, GET } = await import('../../api/membego/webhook.ts');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log('  PASA  ' + name); }
  else { fail++; console.log('  FALLA ' + name); }
};

const secreto = 'test-secret-abc';
const sign = (raw: string) => createHmac('sha256', secreto).update(raw, 'utf8').digest('hex');

let captured: any = null;
(globalThis as any).fetch = async (url: string, opts: any) => {
  captured = { url, opts };
  return new Response(JSON.stringify({ handled: true }), { status: 200 });
};

// GET → 405 (comprueba que la ruta existe)
check('GET → 405 (ruta publicada)', (await GET()).status === 405);

// 1. Firma válida → 200 + reenvío correcto
{
  const evento = { id: 'E1', tipo: 'cliente.registrado', companyId: 'MG-A', payload: { clienteId: 'C1' } };
  const raw = JSON.stringify(evento);
  const res = await POST(new Request('http://x', { method: 'POST', body: raw, headers: { 'x-membego-firma': sign(raw) } }));
  check('firma válida → 200', res.status === 200);
  const body = JSON.parse(captured.opts.body);
  check('reenvía event_id/tipo/companyId/payload correctos',
    body.p_event_id === 'E1' && body.p_tipo === 'cliente.registrado' &&
    body.p_membego_company_id === 'MG-A' && body.p_payload.clienteId === 'C1');
  check('llama al rpc correcto con service_role',
    captured.url.endsWith('/rest/v1/rpc/membego_ingest_event') &&
    captured.opts.headers.Authorization === 'Bearer svc-role-key');
}

// 2. Firma inválida → 401, no reenvía
{
  captured = null;
  const raw = JSON.stringify({ id: 'E2', tipo: 'x', companyId: 'MG-A' });
  const res = await POST(new Request('http://x', { method: 'POST', body: raw, headers: { 'x-membego-firma': 'deadbeef' } }));
  check('firma inválida → 401', res.status === 401);
  check('firma inválida NO reenvía a Supabase', captured === null);
}

// 3. Sobre incompleto → 400
{
  const raw = JSON.stringify({ tipo: 'x' });
  const res = await POST(new Request('http://x', { method: 'POST', body: raw, headers: { 'x-membego-firma': sign(raw) } }));
  check('sobre sin id/companyId → 400', res.status === 400);
}

console.log(`\n  ${pass}/${pass + fail} comprobaciones del webhook`);
if (fail) process.exit(1);
