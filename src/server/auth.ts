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
 * Persistence of admin-changed settings: a ConfigMap (allowlist) + Secret
 * (password) in the editor's namespace, read at startup and merge-patched on
 * change. Env vars are only the bootstrap values — settings objects, when
 * present, win. Deliberately not the Deployment env: env is pod-template
 * state, so writing it rolls the pod and logs every user out (that behavior
 * shipped once and was treated as a bug).
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
  /** Apiserver access for persisting changed settings back to the cluster. */
  apiServer: string;
  token: string;
  /** Apiserver fetch with CA pinning; tests stub this, production passes the
   * undici fetch wired to the apiserver dispatcher. */
  apiFetch?: typeof globalThis.fetch;
  /** Where admin settings persist: a ConfigMap (allowlist) + Secret
   * (password) in the same namespace. Absent → persistence degrades to a
   * warning. Deliberately NOT the Deployment env: env changes are pod
   * template changes, and rolling the pod on every save logs every user out. */
  settings?: { namespace: string; configMap: string; secret: string };
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
// NOTE: always emit through the `setCookie` wrapper below — Hono's bare
// `c.header('set-cookie', …)` REPLACES the header, and joining several
// cookies into one header makes browsers and curl reject the whole header.

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/**
 * Hono's `c.header` REPLACES a header by default — two `set-cookie` calls
 * without `{ append: true }` leave only the last cookie in the response.
 * This wrapper keeps every cookie in its own header, never joined.
 */
function setCookie(c: { header: (name: string, value: string, options?: object) => void }, header: string): void {
  c.header('set-cookie', header, { append: true });
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

/** Settings payloads live under `.data` (ConfigMap string map / Secret
 * base64 map); everything else about the object is irrelevant here. */
function resDataOf(obj: unknown): Record<string, string> | undefined {
  const data = (obj as { data?: Record<string, string> } | null)?.data;
  return data && typeof data === 'object' ? data : undefined;
}

export function createAuthRoutes(deps: AuthDeps): AuthRoutes {
  const sessions = new Map<string, Session>();
  const allowed = new Set(deps.allowedUsers);
  let adminPassword = deps.adminPassword;
  let persistWarning: string | null = null;

  // Resolved per call: tests stub global fetch after makeApp (same rule as
  // upstreamFetch / idpFetch below).
  const apiFetch: () => typeof globalThis.fetch = deps.apiFetch
    ? () => deps.apiFetch!
    : () => globalThis.fetch;

  const insecure = deps.oidc?.insecureTls !== false;
  const oidcDispatcher = insecure
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  // Insecure mode must use undici's fetch (the dispatcher's own copy — Node's
  // global fetch rejects foreign Agents). Secure mode keeps globalThis.fetch,
  // which is also what tests stub: undici's fetch would bypass the stub.
  // Resolved per call, not captured at construction — same lazy-binding rule
  // as the proxy's upstreamFetch (tests stub global fetch after makeApp).
  const idpFetch: () => typeof globalThis.fetch = insecure
    ? () => (undiciFetch as unknown as typeof globalThis.fetch)
    : () => globalThis.fetch;

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

  /** GET, create, or merge-patch one settings object; true on any success
   * (404 counts as "absent", not a failure — callers create it). */
  const settingsCall = async (
    kind: 'configmaps' | 'secrets',
    method: 'GET' | 'POST' | 'PATCH',
    body?: string,
  ): Promise<{ ok: boolean; notFound: boolean; status?: number; data?: Record<string, string> }> => {
    if (!deps.settings) return { ok: false, notFound: true };
    const name = deps.settings[kind === 'configmaps' ? 'configMap' : 'secret'];
    // POST (create) targets the collection URL — the apiserver answers 405 on
    // object URLs; GET/PATCH address the object itself.
    const url = `${deps.apiServer}/api/v1/namespaces/${deps.settings.namespace}/${kind}${method === 'POST' ? '' : `/${name}`}`;
    try {
      const res = await apiFetch()(url, {
        method,
        ...(body
          ? {
              headers: {
                authorization: `Bearer ${deps.token}`,
                'content-type': method === 'POST'
                  ? 'application/json'
                  : 'application/strategic-merge-patch+json',
              },
              body,
            }
          : { headers: { authorization: `Bearer ${deps.token}` } }),
      });
      if (res.ok) return { ok: true, notFound: false, data: resDataOf(await res.json().catch(() => null)) };
      if (res.status === 404) return { ok: true, notFound: true };
      console.error(`settings ${method} ${kind} failed:`, res.status, await res.text().catch(() => ''));
      return { ok: false, notFound: false, status: res.status };
    } catch (err) {
      console.error(`settings ${method} ${kind} error:`, err);
      return { ok: false, notFound: false };
    }
  };

  // Strategic-merge PATCH does not create, so first save probes with GET and
  // POSTs a full object when the ConfigMap/Secret isn't there yet. Returns
  // null on success, else the warning string to surface.
  const settingsWrite = async (
    kind: 'configmaps' | 'secrets',
    data: Record<string, string>,
  ): Promise<string | null> => {
    const existing = await settingsCall(kind, 'GET');
    if (existing.notFound) {
      const manifest = kind === 'configmaps'
        ? { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: deps.settings!.configMap, namespace: deps.settings!.namespace }, data }
        : { apiVersion: 'v1', kind: 'Secret', metadata: { name: deps.settings!.secret, namespace: deps.settings!.namespace }, type: 'Opaque', data };
      const created = await settingsCall(kind, 'POST', JSON.stringify(manifest));
      return created.ok ? null : `persist-failed-${created.status ?? 'error'}`;
    }
    if (!existing.ok) return `persist-failed-${existing.status ?? 'error'}`;
    const patched = await settingsCall(kind, 'PATCH', JSON.stringify({ data }));
    return patched.ok ? null : `persist-failed-${patched.status ?? 'error'}`;
  };

  // Startup load is awaited lazily on the first admin/OIDC request — firing
  // it un-awaited races the request handlers in tests and at boot.
  let loaded: Promise<void> | null = null;
  const ensureLoaded = (): Promise<void> =>
    (loaded ??= (async () => {
      const res = await settingsCall('configmaps', 'GET');
      if (res.ok && !res.notFound && res.data?.allowedUsers) {
        for (const u of res.data.allowedUsers.split(',').map(s => s.trim()).filter(Boolean)) allowed.add(u);
      }
      // The password lives beside it in the Secret; a stored one wins over env.
      const pw = await settingsCall('secrets', 'GET');
      const stored = pw.data?.adminPassword;
      if (pw.ok && !pw.notFound && stored) {
        try {
          adminPassword = atob(stored);
        } catch {
          console.error('stored adminPassword is not valid base64; keeping env value');
        }
      }
    })());

  /** Persist allowlist changes; the running process updates memory first and
   * a failure only surfaces as a warning (never blocks the request). */
  const persistAllowed = async (): Promise<void> => {
    if (!deps.settings) {
      persistWarning = 'persist-unconfigured';
      return;
    }
    persistWarning = await settingsWrite('configmaps', { allowedUsers: [...allowed].sort().join(',') });
  };

  const persistPassword = async (password: string): Promise<void> => {
    if (!deps.settings) {
      persistWarning = 'persist-unconfigured';
      return;
    }
    persistWarning = await settingsWrite('secrets', { adminPassword: btoa(password) });
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
      setCookie(c, cookieHeader(SESSION_COOKIE, token, SESSION_TTL / 1000));
      return c.json({ authenticated: true, user: deps.adminUsername, role: 'admin' });
    }
    return c.json({ error: 'invalid-credentials' }, 401);
  });

  routes.post('/auth/logout', c => {
    const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    if (token) sessions.delete(token);
    setCookie(c, cookieHeader(SESSION_COOKIE, '', 0));
    return c.json({ ok: true });
  });

  // ── Admin: allowlist + password ──────────────────────────────────────────

  routes.get('/auth/users', requireAdmin, async c => {
    await ensureLoaded();
    return c.json({ users: [...allowed].sort() });
  });

  routes.post('/auth/users', async c => {
    await ensureLoaded();
    const body = (await c.req.json().catch(() => ({}))) as { username?: string };
    const username = body.username?.trim();
    if (!username) return c.json({ error: 'invalid-username' }, 400);
    if (allowed.has(username)) return c.json({ users: [...allowed].sort() });
    allowed.add(username);
    await persistAllowed();
    return c.json({ users: [...allowed].sort(), warning: persistWarning });
  });

  routes.delete('/auth/users/:username', async c => {
    await ensureLoaded();
    const username = c.req.param('username');
    allowed.delete(username);
    await persistAllowed();
    return c.json({ users: [...allowed].sort(), warning: persistWarning });
  });

  routes.post('/auth/password', async c => {
    await ensureLoaded();
    const body = (await c.req.json().catch(() => ({}))) as { current?: string; next?: string };
    if (!body.current || !passwordMatches(body.current, adminPassword)) {
      return c.json({ error: 'invalid-credentials' }, 401);
    }
    if (!body.next || body.next.length < 8) return c.json({ error: 'weak-password' }, 400);
    adminPassword = body.next;
    await persistPassword(adminPassword);
    return c.json({ ok: true, warning: persistWarning });
  });

  // ── OIDC authorization-code flow ─────────────────────────────────────────

  let discovery: { authorization: string; token: string } | null = null;
  const discover = async (): Promise<{ authorization: string; token: string }> => {
    if (discovery) return discovery;
    const res = await idpFetch()(`${deps.oidc!.issuer}/.well-known/openid-configuration`, {
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
    // Two separate Set-Cookie headers — never joined.
    setCookie(c, cookieHeader(STATE_COOKIE, state, 600));
    setCookie(c, cookieHeader(NONCE_COOKIE, nonce, 600));
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
    const res = await idpFetch()(token, {
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
    await ensureLoaded();
    if (!allowed.has(username)) {
      // The admin decides who may sign in; everyone else is turned away here.
      return c.json({ error: 'not-allowed', user: username }, 403);
    }

    const token2 = newSession(username, 'user');
    const maxAge = SESSION_TTL / 1000;
    // Each in its own Set-Cookie header (see setCookie note).
    setCookie(c, cookieHeader(SESSION_COOKIE, token2, maxAge));
    setCookie(c, cookieHeader(STATE_COOKIE, '', 0));
    setCookie(c, cookieHeader(NONCE_COOKIE, '', 0));
    return c.redirect('/');
  });

  return { routes, hasSession: cookie => sessionOf(cookie) !== null };
}
