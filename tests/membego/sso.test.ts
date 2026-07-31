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

console.log(`\n  ${pass}/${pass + fail} comprobaciones del SSO`);
if (fail) process.exit(1);
