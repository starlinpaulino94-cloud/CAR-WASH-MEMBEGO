/**
 * Emulador mínimo de la superficie HTTP de Supabase, para poder ejecutar la
 * aplicación real contra PostgreSQL + PostgREST sin conexión al proyecto
 * alojado.
 *
 * Cubre solo lo que usa el código migrado:
 *   POST /auth/v1/token?grant_type=password  -> sesión con JWT firmado
 *   GET  /auth/v1/user                       -> usuario de la sesión
 *   POST /auth/v1/logout                     -> cierre de sesión
 *   *    /rest/v1/**                         -> PostgREST
 *
 * NO forma parte de la aplicación: es andamiaje de pruebas.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const JWT_SECRET = process.env.JWT_SECRET ?? 'una-clave-de-pruebas-de-al-menos-32-caracteres';
const POSTGREST = process.env.POSTGREST_URL ?? 'http://127.0.0.1:3001';
const PORT = Number(process.env.PORT ?? 3002);

// Usuarios de prueba. En Supabase real esto lo gestiona GoTrue.
const USERS = new Map([
  ['cajero@example.com', { id: '33333333-3333-3333-3333-333333333333', password: 'clave-de-prueba' }],
]);

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function makeSession(user, email) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt({
    sub: user.id, email, role: 'authenticated', aud: 'authenticated',
    iat: now, exp: now + 3600,
  });
  return {
    access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    refresh_token: 'refresh-de-prueba',
    user: {
      id: user.id, aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: new Date(0).toISOString(),
      app_metadata: { provider: 'email' }, user_metadata: {},
      created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
    },
  };
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range, content-location',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  const json = (code, obj) => {
    res.writeHead(code, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // ------------------------------------------------------------ auth
  if (url.pathname === '/auth/v1/token') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const user = USERS.get(body.email);
    if (!user || user.password !== body.password) {
      return json(400, { error: 'invalid_grant', error_description: 'Credenciales inválidas' });
    }
    return json(200, makeSession(user, body.email));
  }

  if (url.pathname === '/auth/v1/user') {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return json(200, { id: payload.sub, email: payload.email, aud: 'authenticated', role: 'authenticated' });
    } catch { return json(401, { message: 'sin sesión' }); }
  }

  if (url.pathname === '/auth/v1/logout') { res.writeHead(204, CORS); return res.end(); }

  // ------------------------------------------------------------ rest
  if (url.pathname.startsWith('/rest/v1')) {
    const target = POSTGREST + url.pathname.replace('/rest/v1', '') + url.search;
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);

    const headers = { ...req.headers };
    delete headers.host; delete headers.origin; delete headers.referer;
    delete headers['content-length']; delete headers.connection;
    delete headers.apikey;   // PostgREST no la conoce

    try {
      const upstream = await fetch(target, { method: req.method, headers, body });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        ...CORS,
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      return res.end(text);
    } catch (err) {
      return json(502, { message: `proxy: ${err.message}` });
    }
  }

  json(404, { message: 'no encontrado' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`proxy Supabase escuchando en http://127.0.0.1:${PORT} -> ${POSTGREST}`);
});
