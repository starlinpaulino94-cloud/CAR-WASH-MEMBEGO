import { createHmac } from 'node:crypto';

process.env.MEMBEGO_SECRETO = 'sso-secret';
const { verificarTokenMembego } = await import('../../api/sso/membego.ts');

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log('  PASA  ' + name); }
  else { fail++; console.log('  FALLA ' + name); }
};

const sign = (cuerpo: string) => createHmac('sha256', 'sso-secret').update(cuerpo, 'utf8').digest('hex');
const mkToken = (payload: object) => {
  const cuerpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return cuerpo + '.' + sign(cuerpo);
};
const futuro = Math.floor(Date.now() / 1000) + 60;
const base = { sub: 'u1', email: 'e@x.com', rol: 'GERENTE', companyId: 'MG-A', exp: futuro };

check('token válido → devuelve el payload',
  verificarTokenMembego(mkToken(base))?.companyId === 'MG-A');

// firma alterada
{
  const t = mkToken(base);
  const roto = t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa');
  check('firma alterada → null', verificarTokenMembego(roto) === null);
}

check('token vencido → null',
  verificarTokenMembego(mkToken({ ...base, exp: Math.floor(Date.now() / 1000) - 5 })) === null);

check('sin companyId → null',
  verificarTokenMembego(mkToken({ ...base, companyId: undefined })) === null);

check('cuerpo sin firma → null', verificarTokenMembego('soloelcuerpo') === null);

// --- Endurecimiento del borde GET: config faltante → 503 (no 500 opaco).
// Este módulo solo tiene MEMBEGO_SECRETO; faltan SUPABASE_URL y SERVICE_ROLE.
{
  const { GET } = await import('../../api/sso/membego.ts');
  const res = await GET(new Request('https://x/sso/membego?token=' + mkToken(base)));
  check('GET sin SUPABASE_URL/SERVICE_ROLE → 503 (config faltante)', res.status === 503);
  const body = await res.text();
  check('el 503 nombra las variables que faltan',
    body.includes('SUPABASE_URL') && body.includes('SUPABASE_SERVICE_ROLE_KEY'));
}

// --- Con config presente pero token inválido → 401 (no 500, no toca a Supabase).
{
  process.env.SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const spec = '../../api/sso/membego.ts?withcfg';
  const { GET } = await import(spec);
  let llamo = false;
  (globalThis as any).fetch = async () => { llamo = true; return new Response('{}', { status: 200 }); };
  const res = await GET(new Request('https://x/sso/membego?token=basura.sinfirma'));
  check('GET con token inválido → 401', res.status === 401);
  check('token inválido NO llama a Supabase', llamo === false);
}

console.log(`\n  ${pass}/${pass + fail} comprobaciones del SSO`);
if (fail) process.exit(1);
