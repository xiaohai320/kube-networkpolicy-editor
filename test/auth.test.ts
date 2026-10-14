import { describe, it, expect, vi } from 'vitest';
import { createClusterProxyApp } from '@/server/app';

/**
 * Auth seam: the Hono app with auth wired. Login/OIDC/admin endpoints are
 * exercised through the public app surface; OIDC round-trips stub global
 * fetch (the IdP discovery/token calls) exactly like the proxy tests stub
 * the apiserver.
 */

const ADMIN = 'admin';
const PASSWORD = 'secret-pw-123';

function makeApp(opts: { allowed?: string[]; oidc?: boolean; persist?: boolean } = {}) {
  return createClusterProxyApp({
    apiServer: 'https://apiserver.example:6443',
    token: 'sa-token',
    ca: false,
    auth: {
      adminUsername: ADMIN,
      adminPassword: PASSWORD,
      allowedUsers: opts.allowed ?? [],
      apiServer: 'https://apiserver.example:6443',
      token: 'sa-token',
      // No settings coordinates unless asked: persistence degrades to a warning.
      ...(opts.persist
        ? {
            settings: {
              namespace: 'netpol-editor',
              configMap: 'netpol-editor-settings',
              secret: 'netpol-editor-settings',
            },
          }
        : {}),
      ...(opts.oidc
        ? {
            oidc: {
              issuer: 'https://idp.example',
              clientId: 'client-x',
              clientSecret: 'secret-x',
              // Secure mode routes IdP calls through globalThis.fetch, which
              // these tests stub; insecure mode would use undici's own fetch.
              insecureTls: false,
            },
          }
        : {}),
    },
  });
}

/** Login and return the session cookie for subsequent requests. */
async function loginCookie(app: ReturnType<typeof createClusterProxyApp>): Promise<string> {
  const res = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

describe('local admin login', () => {
  it('issues an httpOnly session cookie', async () => {
    const app = makeApp();
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('netpol_session=');
    expect(cookie).not.toContain(PASSWORD);
  });

  it('emits each OIDC cookie as its own Set-Cookie header (joined cookies are rejected whole)', async () => {
    const app = makeApp({ oidc: true });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        authorization_endpoint: 'https://idp.example/auth',
        token_endpoint: 'https://idp.example/token',
      }), { status: 200, headers: { 'content-type': 'application/json' } })));
    try {
      const res = await app.request('/auth/oidc/start');
      expect(res.status).toBe(302);
      // Response.headers.get('set-cookie') joins multiple headers with ', ' —
      // if any cookie were merged into one header via '; ' it would be part of
      // the FIRST cookie's value/attributes instead of a header separator.
      const raw = res.headers.get('set-cookie')!;
      const headers = raw.split(', ').filter(Boolean);
      const stateC = headers.find(h => h.startsWith('netpol_oidc_state='));
      const nonceC = headers.find(h => h.startsWith('netpol_oidc_nonce='));
      expect(stateC).toBeDefined();
      expect(nonceC).toBeDefined();
      // Each header must start with its own name and hold exactly one pair.
      expect(stateC!.split(';')[0]!.startsWith('netpol_oidc_state=')).toBe(true);
      expect(nonceC!.split(';')[0]!.startsWith('netpol_oidc_nonce=')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects wrong credentials', async () => {
    const app = makeApp();
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN, password: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('gates /k8s/* behind a session', async () => {
    const app = makeApp();
    const denied = await app.request('/k8s/apis/networking.k8s.io/v1/networkpolicies');
    expect(denied.status).toBe(401);

    const cookie = await loginCookie(app);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ kind: 'NetworkPolicyList', items: [] }), { status: 200 })));
    try {
      const ok = await app.request('/k8s/apis/networking.k8s.io/v1/networkpolicies', {
        headers: { cookie },
      });
      expect(ok.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('allows only the admin to manage users', async () => {
    const app = makeApp();
    const adminCookie = await loginCookie(app);
    const res = await app.request('/auth/users', { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);

    const nobody = await app.request('/auth/users');
    expect(nobody.status).toBe(403);
  });

  it('adds and removes allowlist users', async () => {
    const app = makeApp();
    const cookie = await loginCookie(app);
    const add = await app.request('/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ username: 'jdoe' }),
    });
    expect((await add.json()).users).toContain('jdoe');

    const del = await app.request('/auth/users/jdoe', { method: 'DELETE', headers: { cookie } });
    expect((await del.json()).users).not.toContain('jdoe');
  });

  it('changes the admin password and re-validates', async () => {
    const app = makeApp();
    const cookie = await loginCookie(app);
    const change = await app.request('/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ current: PASSWORD, next: 'new-pw-456789' }),
    });
    expect(change.status).toBe(200);

    const oldLogin = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN, password: PASSWORD }),
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN, password: 'new-pw-456789' }),
    });
    expect(newLogin.status).toBe(200);
  });
});

describe('settings persistence', () => {
  /**
   * Admin settings live in a ConfigMap (allowlist) + Secret (password) so a
   * change does NOT touch the pod template — the old env self-patch rolled
   * the pod on every save and logged everyone out. Stub the upstream fetch
   * and record calls; the apiserver is never actually hit.
   */
  interface Call { method: string; url: string; body?: string }
  let calls: Call[];

  const urlOf = (kind: 'configmaps' | 'secrets') =>
    `https://apiserver.example:6443/api/v1/namespaces/netpol-editor/${kind}/netpol-editor-settings`;

  function stub() {
    const objects: Record<string, { status: number; body: string }> = {};
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? init.body : undefined });
      if (init.method === 'POST') {
        // A POST to the collection url makes the object GET-able at the
        // object url (strip the collection suffix).
        const objectUrl = url.replace(/\/(configmaps|secrets)$/, (_, kind) => `/${kind}/netpol-editor-settings`);
        objects[`GET ${objectUrl}`] = { status: 201, body: init.body as string };
        return new Response(init.body as string, { status: 201 });
      }
      const hit = objects[`${init.method ?? 'GET'} ${url}`];
      return new Response(hit?.body ?? 'not found', { status: hit ? 200 : 404 });
    }));
    return objects;
  }

  it('creates the settings ConfigMap on first save and patches it after', async () => {
    stub();
    const app = makeApp({ persist: true });
    const cookie = await loginCookie(app);

    const add = await app.request('/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ username: 'jdoe' }),
    });
    expect(add.status).toBe(200);
    expect((await add.json()).warning).toBeNull();

    // First save: nothing existed, so the allowlist lands as a CREATE — the
    // POST goes to the COLLECTION url (the apiserver 405s object-url POSTs).
    const createCall = calls.find(c => c.method === 'POST' && c.url.includes('configmaps'));
    expect(createCall).toBeDefined();
    expect(createCall!.url.endsWith('/api/v1/namespaces/netpol-editor/configmaps')).toBe(true);
    expect(JSON.parse(createCall!.body!)).toMatchObject({
      metadata: { name: 'netpol-editor-settings', namespace: 'netpol-editor' },
      data: { allowedUsers: 'jdoe' },
    });

    // ...and the second save PATCHes instead of recreating.
    await app.request('/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ username: 'second' }),
    });
    const patchCalls = calls.filter(c => c.method === 'PATCH' && c.url.includes('configmaps'));
    expect(patchCalls).toHaveLength(1);
    expect(JSON.parse(patchCalls[0]!.body!)).toMatchObject({ data: { allowedUsers: 'jdoe,second' } });
  });

  it('saves the password to the Secret, never to the ConfigMap', async () => {
    stub();
    const app = makeApp({ persist: true });
    const cookie = await loginCookie(app);

    const change = await app.request('/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ current: PASSWORD, next: 'new-pw-456789' }),
    });
    expect(change.status).toBe(200);

    const secretCalls = calls.filter(c => c.url.includes('secrets'));
    expect(secretCalls.length).toBeGreaterThan(0);
    const secretWrite = secretCalls.find(c => c.method === 'POST' || c.method === 'PATCH');
    // Secret data values are base64; the plaintext must not appear anywhere.
    expect(secretWrite!.body).not.toContain('new-pw-456789');
    expect(atob(JSON.parse(secretWrite!.body!).data.adminPassword)).toBe('new-pw-456789');
    expect(calls.some(c => c.url.includes('configmaps') && (c.method === 'POST' || c.method === 'PATCH'))).toBe(false);
  });

  it('does not touch the pod template — no Deployment calls at all', async () => {
    stub();
    const app = makeApp({ persist: true });
    const cookie = await loginCookie(app);

    await app.request('/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ username: 'jdoe' }),
    });
    expect(calls.some(c => c.url.includes('deployments'))).toBe(false);
  });

  it('loads the allowlist from the ConfigMap at startup when present', async () => {
    // The load happens lazily on first use — stub before building the app.
    const objects = stub();
    objects[`GET ${urlOf('configmaps')}`] = {
      status: 200,
      body: JSON.stringify({ data: { allowedUsers: 'jdoe,second' } }),
    };
    const app = makeApp({ persist: true });
    const cookie = await loginCookie(app);

    const res = await app.request('/auth/users', { headers: { cookie } });
    expect((await res.json()).users).toEqual(['jdoe', 'second']);
  });

  it('falls back to env allowlist when the ConfigMap is absent', async () => {
    stub();
    const app = makeApp({ persist: true, allowed: ['env-user'] });
    const cookie = await loginCookie(app);

    const res = await app.request('/auth/users', { headers: { cookie } });
    expect((await res.json()).users).toEqual(['env-user']);
    // And a subsequent save CREATES the missing ConfigMap.
    await app.request('/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ username: 'env-user2' }),
    });
    expect(calls.some(c => c.method === 'POST' && c.url.includes('configmaps'))).toBe(true);
  });

  it('reports a persist failure as a warning instead of failing the request', async () => {
    stub();
    const app = makeApp({ persist: true });
    const cookie = await loginCookie(app);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })));

    const res = await app.request('/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ username: 'jdoe' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).warning).toBe('persist-failed-403');
  });
});
