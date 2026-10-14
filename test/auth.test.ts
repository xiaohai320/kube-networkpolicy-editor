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

function makeApp(opts: { allowed?: string[]; oidc?: boolean } = {}) {
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
      // No deployment coordinates: persistence degrades to a warning.
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
