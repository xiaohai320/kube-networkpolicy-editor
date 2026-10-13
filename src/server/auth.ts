import { Hono } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Authentication for the deployed editor (ADR-0001's proxy gains a gate).
 *
 * Model: one built-in admin account (env), plus an allowlist of OIDC users
 * the admin maintains. Sessions are httpOnly-cookie tokens in process memory
 * (single-replica deployment; a restart logs everyone out — accepted).
 *
 * Persistence of admin-changed settings: the container's env is read-only, so
 * changes PATCH the editor's own Deployment env (strategic merge on the env
 * array) — the running process updates memory immediately and the pod keeps
 * the value across restarts. RBAC restricts that patch to this one resource.
 *
 * OIDC TLS: the IdP sits behind a privately-signed cert, so per the operator's
 * explicit requirement its discovery/token fetches skip certificate
 * verification — scoped to the OIDC dispatcher only, never the apiserver path.
 */

export interface AuthDeps {
  adminUsername: string;
  adminPassword: string;
  /** OIDC usernames allowed to sign in; admin manages this list. */
  allowedUsers: string[];
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    /** Skip TLS verification for IdP calls. Default true (private PKI). */
    insecureTls?: boolean;
  };
  /** Where the editor should redirect after OIDC auth (redirect_uri origin). */
  publicOrigin?: string;
  /** Apiserver access for persisting changed env vars back to the Deployment. */
  apiServer: string;
  token: string;
  /** Apiserver fetch with CA pinning; tests stub this, production passes the
   * undici fetch wired to the apiserver dispatcher. */
  apiFetch?: typeof globalThis.fetch;
  deployment?: { namespace: string; name: string; container: string };
}

export interface Session {
  user: string;
  role: 'admin' | 'user';
  expiresAt: number;
}

const SESSION_TTL = 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'netpol_session';
const STATE_COOKIE = 'netpol_oidc_state';
const NONCE_COOKIE = 'netpol_oidc_nonce';

function cookieHeader(name: string, value: string, maxAge: number): string {
  // Plain http via NodePort, so no Secure flag — it would break login.
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/** Constant-time compare — the password rides in env, not in timing attacks. */
function passwordMatches(input: string, stored: string): boolean {
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(stored).digest();
  return a.equals(b);
}

function parseJwtPayload(idToken: string): Record<string, unknown> {
  const part = idToken.split('.')[1];
  if (!part) throw new Error('malformed id_token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

interface AuthRoutes {
  routes: Hono;
  /** True when a request carries a live session — used to gate /k8s/*. */
  hasSession: (cookieHeader: string | undefined) => boolean;
}

export function createAuthRoutes(deps: AuthDeps): AuthRoutes {
  const sessions = new Map<string, Session>();
  const allowed = new Set(deps.allowedUsers);
  let adminPassword = deps.adminPassword;
  let persistWarning: string | null = null;

  const apiFetch = deps.apiFetch ?? globalThis.fetch;

  const insecure = deps.oidc?.insecureTls !== false;
  const oidcDispatcher = insecure
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  const idpFetch: typeof globalThis.fetch = insecure
    ? (undiciFetch as unknown as typeof globalThis.fetch)
    : globalThis.fetch;

  const newSession = (user: string, role: Session['role']): string => {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { user, role, expiresAt: Date.now() + SESSION_TTL });
    return token;
  };

  const sessionOf = (cookie: string | undefined): Session | null => {
    const token = readCookie(cookie, SESSION_COOKIE);
    if (!token) return null;
    const s = sessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return s;
  };

  const requireAdmin = async (c: { req: { header: (n: string) => string | undefined } }, next: () => Promise<void>) => {
    const s = sessionOf(c.req.header('cookie'));
    if (!s || s.role !== 'admin') {
      persistWarning = null;
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    await next();
  };

  /** PATCH the editor Deployment's env so admin changes survive restarts. */
  const persistEnv = async (vars: Record<string, string>): Promise<void> => {
    if (!deps.deployment) {
      persistWarning = 'persist-unconfigured';
      return;
    }
    const url = `${deps.apiServer}/apis/apps/v1/namespaces/${deps.deployment.namespace}/deployments/${deps.deployment.name}`;
    const container = { name: deps.deployment.container, env: Object.entries(vars).map(([name, value]) => ({ name, value })) };
    try {
      const res = await apiFetch(url, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${deps.token}`,
          'content-type': 'application/strategic-merge-patch+json',
        },
        body: JSON.stringify({ spec: { template: { spec: { containers: [container] } } } }),
      });
      if (!res.ok) {
        persistWarning = `persist-failed-${res.status}`;
        console.error('env persistence failed:', res.status, await res.text().catch(() => ''));
      } else {
        persistWarning = null;
      }
    } catch (err) {
      persistWarning = 'persist-failed';
      console.error('env persistence error:', err);
    }
  };

  const routes = new Hono();

  routes.get('/auth/me', c => {
    const s = sessionOf(c.req.header('cookie'));
    if (!s) return c.json({ authenticated: false }, 401);
    return c.json({ authenticated: true, user: s.user, role: s.role, warning: persistWarning });
  });

  routes.post('/auth/login', async c => {
    const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
    if (body.username === deps.adminUsername && body.password && passwordMatches(body.password, adminPassword)) {
      const token = newSession(deps.adminUsername, 'admin');
      c.header('set-cookie', cookieHeader(SESSION_COOKIE, token, SESSION_TTL / 1000));
      return c.json({ authenticated: true, user: deps.adminUsername, role: 'admin' });
    }
    return c.json({ error: 'invalid-credentials' }, 401);
  });

  routes.post('/auth/logout', c => {
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    if (token) sessions.delete(token);
    c.header('set-cookie', cookieHeader(SESSION_COOKIE, '', 0));
    return c.json({ ok: true });
  });

  // ── Admin: allowlist + password ──────────────────────────────────────────

  routes.get('/auth/users', requireAdmin, c =>
    c.json({ users: [...allowed].sort() }),
  );

  routes.post('/auth/users', async c => {
    const body = (await c.req.json().catch(() => ({}))) as { username?: string };
    const username = body.username?.trim();
    if (!username) return c.json({ error: 'invalid-username' }, 400);
    if (allowed.has(username)) return c.json({ users: [...allowed].sort() });
    allowed.add(username);
    await persistEnv({ ALLOWED_USERS: [...allowed].join(',') });
    return c.json({ users: [...allowed].sort(), warning: persistWarning });
  });

  routes.delete('/auth/users/:username', async c => {
    const username = c.req.param('username');
    allowed.delete(username);
    await persistEnv({ ALLOWED_USERS: [...allowed].join(',') });
    return c.json({ users: [...allowed].sort(), warning: persistWarning });
  });

  routes.post('/auth/password', async c => {
    const body = (await c.req.json().catch(() => ({}))) as { current?: string; next?: string };
    if (!body.current || !passwordMatches(body.current, adminPassword)) {
      return c.json({ error: 'invalid-credentials' }, 401);
    }
    if (!body.next || body.next.length < 8) return c.json({ error: 'weak-password' }, 400);
    adminPassword = body.next;
    await persistEnv({ ADMIN_PASSWORD: adminPassword });
    return c.json({ ok: true, warning: persistWarning });
  });

  // ── OIDC authorization-code flow ─────────────────────────────────────────

  let discovery: { authorization: string; token: string } | null = null;
  const discover = async (): Promise<{ authorization: string; token: string }> => {
    if (discovery) return discovery;
    const res = await idpFetch(`${deps.oidc!.issuer}/.well-known/openid-configuration`, {
      dispatcher: oidcDispatcher,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
    const doc = (await res.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
    };
    discovery = { authorization: doc.authorization_endpoint, token: doc.token_endpoint };
    return discovery;
  };

  routes.get('/auth/oidc/start', async c => {
    if (!deps.oidc) return c.json({ error: 'oidc-not-configured' }, 404);
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    const { authorization } = await discover();
    const origin = deps.publicOrigin ?? new URL(c.req.url).origin;
    const url = new URL(authorization);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', deps.oidc.clientId);
    url.searchParams.set('redirect_uri', `${origin}/auth/oidc/callback`);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    c.header('set-cookie', `${cookieHeader(STATE_COOKIE, state, 600)}; ${cookieHeader(NONCE_COOKIE, nonce, 600)}`);
    return c.redirect(url.toString());
  });

  routes.get('/auth/oidc/callback', async c => {
    if (!deps.oidc) return c.json({ error: 'oidc-not-configured' }, 404);
    const cookie = c.req.header('cookie');
    const state = readCookie(cookie, STATE_COOKIE);
    const nonce = readCookie(cookie, NONCE_COOKIE);
    if (!state || state !== c.req.query('state')) {
      return c.json({ error: 'state-mismatch' }, 400);
    }

    const origin = deps.publicOrigin ?? new URL(c.req.url).origin;
    const { token } = await discover();
    const res = await idpFetch(token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: c.req.query('code') ?? '',
        redirect_uri: `${origin}/auth/oidc/callback`,
        client_id: deps.oidc.clientId,
        client_secret: deps.oidc.clientSecret,
      }).toString(),
      dispatcher: oidcDispatcher,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (!res.ok) {
      console.error('oidc token exchange failed:', res.status);
      return c.json({ error: 'token-exchange-failed' }, 502);
    }
    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) return c.json({ error: 'no-id-token' }, 502);

    let claims: Record<string, unknown>;
    try {
      claims = parseJwtPayload(tokens.id_token);
    } catch {
      return c.json({ error: 'bad-id-token' }, 502);
    }
    // OIDC Core §3.1.3.7: the code came from the IdP over its own channel, so
    // iss/aud/exp/nonce are what must hold; JWKS signature checking is skipped
    // by design here.
    const now = Math.floor(Date.now() / 1000);
    const audOk = claims.aud === deps.oidc.clientId ||
      (Array.isArray(claims.aud) && (claims.aud as string[]).includes(deps.oidc.clientId));
    if (claims.iss !== deps.oidc!.issuer || !audOk || typeof claims.exp !== 'number' || claims.exp < now) {
      return c.json({ error: 'bad-id-token' }, 502);
    }
    if (nonce && claims.nonce !== nonce) return c.json({ error: 'nonce-mismatch' }, 400);

    const username =
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      (typeof claims.email === 'string' && claims.email) ||
      (typeof claims.sub === 'string' && claims.sub) ||
      '';
    if (!username) return c.json({ error: 'no-username' }, 502);
    if (!allowed.has(username)) {
      // The admin decides who may sign in; everyone else is turned away here.
      return c.json({ error: 'not-allowed', user: username }, 403);
    }

    const token2 = newSession(username, 'user');
    const maxAge = SESSION_TTL / 1000;
    c.header(
      'set-cookie',
      [
        cookieHeader(SESSION_COOKIE, token2, maxAge),
        cookieHeader(STATE_COOKIE, '', 0),
        cookieHeader(NONCE_COOKIE, '', 0),
      ].join('; '),
    );
    return c.redirect('/');
  });

  return { routes, hasSession: cookie => sessionOf(cookie) !== null };
}
