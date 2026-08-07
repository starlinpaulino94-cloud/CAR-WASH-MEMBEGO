import { createHmac } from 'node:crypto';

process.env.MEMBEGO_SECRETO = 'salida-secret-xyz';
process.env.SUPABASE_URL = 'http://supabase.local';
process.env.MEMBEGO_SISTEMA_SLUG = 'carwash';
process.env.MEMBEGO_SSO_ENTRADA_URL = 'https://membego.com/sso/entrar';

const { POST, firmarPase, construirUrl } = await import('../../api/ir-a-membego.ts');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log('  PASA  ' + name); }
  else { fail++; console.log('  FALLA ' + name); }
};

const secreto = 'salida-secret-xyz';

// --- firmarPase: formato exacto del contrato (base64url(JSON).hmacHex minúsculas)
{
  const pase = firmarPase({ email: 'a@b.com', companyId: 'MG-1', exp: 1900000000 });
  const punto = pase.lastIndexOf('.');
  const cuerpo = pase.slice(0, punto);
  const firma = pase.slice(punto + 1);
  const esperada = createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex');
  check('pase tiene 2 partes (no-JWT)', pase.split('.').length === 2);
  check('firma es HMAC-SHA256 hex minúsculas del cuerpo', firma === esperada && firma === firma.toLowerCase());
  const json = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  check('payload lleva email/companyId/exp', json.email === 'a@b.com' && json.companyId === 'MG-1' && json.exp === 1900000000);
}

// --- construirUrl: incluye sistema y token, sin sub si no hay
{
  const url = construirUrl({ email: 'a@b.com', companyId: 'MG-1' });
  check('URL apunta al endpoint de entrada de Membego', url.startsWith('https://membego.com/sso/entrar?'));
  check('URL incluye sistema=<slug>', url.includes('sistema=carwash'));
  check('URL incluye token=', url.includes('token='));
  const tokenEnc = decodeURIComponent(url.split('token=')[1]);
  const cuerpo = tokenEnc.slice(0, tokenEnc.lastIndexOf('.'));
  const json = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  check('sin sub, el payload no trae sub', json.sub === undefined);
}

// --- construirUrl: incluye sub cuando existe (preferido por Membego)
{
  const url = construirUrl({ email: 'a@b.com', companyId: 'MG-1', sub: 'mg-sub-9' });
  const tokenEnc = decodeURIComponent(url.split('token=')[1]);
  const cuerpo = tokenEnc.slice(0, tokenEnc.lastIndexOf('.'));
  const json = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  check('con sub, el payload lo incluye', json.sub === 'mg-sub-9');
}

// --- POST sin Authorization → 401, no llama a Supabase
{
  let llamo = false;
  (globalThis as any).fetch = async () => { llamo = true; return new Response('{}', { status: 200 }); };
  const res = await POST(new Request('http://x', { method: 'POST' }));
  check('sin sesión (sin Bearer) → 401', res.status === 401);
  check('sin sesión NO llama a Supabase', llamo === false);
}

// --- POST con Bearer → resuelve identidad y devuelve la URL
{
  let capturado: any = null;
  (globalThis as any).fetch = async (url: string, opts: any) => {
    capturado = { url, opts };
    return new Response(JSON.stringify({ email: 'x@y.com', companyId: 'MG-7', sub: 'mg-sub-1' }), { status: 200 });
  };
  const res = await POST(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer USER-JWT' } }));
  check('con sesión → 200', res.status === 200);
  const body = await res.json();
  check('devuelve una URL de entrada con token', typeof body.url === 'string' && body.url.includes('token='));
  check('llama al RPC membego_sso_saliente', capturado.url.endsWith('/rest/v1/rpc/membego_sso_saliente'));
  check('usa el token del USUARIO (apikey y bearer)',
    capturado.opts.headers.apikey === 'USER-JWT' && capturado.opts.headers.Authorization === 'Bearer USER-JWT');
}

// --- POST con Bearer pero empresa sin vincular (RPC 403) → 403
{
  (globalThis as any).fetch = async () => new Response('no vinculada', { status: 400 });
  const res = await POST(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer USER-JWT' } }));
  check('empresa no vinculada / RPC error → 403', res.status === 403);
}

// --- Config faltante → 503 nombrando la variable
{
  delete process.env.MEMBEGO_SISTEMA_SLUG;
  // Especificador en variable: fuerza recarga del módulo (lee env de nuevo) sin
  // que tsc intente resolver el sufijo ?nocfg como un módulo tipado.
  const spec = '../../api/ir-a-membego.ts?nocfg';
  const mod = await import(spec);
  const res = await mod.POST(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer T' } }));
  check('sin MEMBEGO_SISTEMA_SLUG → 503 config_faltante', res.status === 503);
  const body = await res.json();
  check('503 nombra la variable faltante', Array.isArray(body.faltan) && body.faltan.includes('MEMBEGO_SISTEMA_SLUG'));
  process.env.MEMBEGO_SISTEMA_SLUG = 'carwash';
}

console.log(`\n  ${pass}/${pass + fail} comprobaciones del SSO saliente`);
if (fail) process.exit(1);
