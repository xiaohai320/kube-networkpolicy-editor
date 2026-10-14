import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClusterProxyApp } from '@/server/app';

/**
 * Backend app-level tests: fetch in, assert on the request the app makes
 * upstream and the response it returns. The upstream kube-apiserver is stubbed
 * by intercepting global fetch — the app's only outbound dependency.
 */

type FetchCall = { url: string; init: RequestInit };

const upstreamCalls: FetchCall[] = [];
let upstreamResponse: Response;

function stubUpstream(response: Response) {
  upstreamResponse = response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      upstreamCalls.push({ url: String(input), init });
      return upstreamResponse;
    }),
  );
}

const API = 'https://apiserver.example:6443';
const TOKEN = 'sa-token-abc';

/** Read a header off whatever the stub recorded (Headers instance or object). */
function headerOf(init: RequestInit, name: string): string | null {
  const h = init.headers;
  if (h instanceof Headers) return h.get(name);
  if (h && typeof h === 'object') return (h as Record<string, string>)[name] ?? null;
  return null;
}

async function bodyOf(init: RequestInit): Promise<string> {
  const b = init.body;
  if (typeof b === 'string') return b;
  if (b instanceof ReadableStream) return await new Response(b).text();
  return String(b ?? '');
}

function makeApp() {
  return createClusterProxyApp({ apiServer: API, token: TOKEN, ca: false });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('cluster proxy app', () => {
  beforeEach(() => {
    upstreamCalls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards list requests to the upstream apiserver with the token', async () => {
    stubUpstream(json({ kind: 'NetworkPolicyList', items: [] }));
    const res = await makeApp().request(
      '/k8s/apis/networking.k8s.io/v1/networkpolicies',
    );
    expect(res.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    const call = upstreamCalls[0]!;
    expect(call.url).toBe(`${API}/apis/networking.k8s.io/v1/networkpolicies`);
    expect(headerOf(call.init, 'authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('forwards get requests for a namespaced policy', async () => {
    stubUpstream(json({ kind: 'NetworkPolicy', metadata: { name: 'x' } }));
    const res = await makeApp().request(
      '/k8s/apis/networking.k8s.io/v1/namespaces/default/networkpolicies/x',
    );
    expect(res.status).toBe(200);
    expect(upstreamCalls[0]!.url).toBe(
      `${API}/apis/networking.k8s.io/v1/namespaces/default/networkpolicies/x`,
    );
  });

  it('passes query parameters through', async () => {
    stubUpstream(json({ items: [] }));
    await makeApp().request(
      '/k8s/apis/networking.k8s.io/v1/networkpolicies?labelSelector=app%3Dweb',
    );
    expect(upstreamCalls[0]!.url).toContain('labelSelector=app%3Dweb');
  });

  it('server-side applies with the apply content-type and fieldManager', async () => {
    stubUpstream(json({ kind: 'CiliumNetworkPolicy' }, 201));
    const body = 'apiVersion: cilium.io/v2\nkind: CiliumNetworkPolicy\n';
    const res = await makeApp().request(
      '/k8s/apis/cilium.io/v2/namespaces/default/ciliumnetworkpolicies?fieldManager=x',
      {
        method: 'PATCH',
        body,
        headers: { 'content-type': 'application/apply-patch+yaml' },
      },
    );
    expect(res.status).toBe(201);
    const call = upstreamCalls[0]!;
    expect(call.init.method).toBe('PATCH');
    expect(headerOf(call.init, 'content-type')).toBe('application/apply-patch+yaml');
    expect(await bodyOf(call.init)).toBe(body);
  });

  it('forwards DELETE verbatim (delete-from-cluster pins the passthrough contract)', async () => {
    stubUpstream(new Response(null, { status: 204 }));
    const res = await makeApp().request(
      '/k8s/apis/networking.k8s.io/v1/namespaces/default/networkpolicies/old',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(204);
    const call = upstreamCalls[0]!;
    expect(call.init.method).toBe('DELETE');
    expect(call.url).toBe(
      `${API}/apis/networking.k8s.io/v1/namespaces/default/networkpolicies/old`,
    );
  });

  it('translates upstream 409 conflicts verbatim', async () => {
    stubUpstream(json({ kind: 'Status', reason: 'Conflict', message: 'conflict' }, 409));
    const res = await makeApp().request('/k8s/apis/networking.k8s.io/v1/networkpolicies', {
      method: 'PATCH',
      body: 'x: y',
      headers: { 'content-type': 'application/apply-patch+yaml' },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: 'Conflict' });
  });

  it('does not leak the upstream token in the response headers', async () => {
    stubUpstream(json({ items: [] }));
    const res = await makeApp().request('/k8s/apis/networking.k8s.io/v1/networkpolicies');
    expect(JSON.stringify([...res.headers.entries()])).not.toContain(TOKEN);
  });

  it('rejects paths outside /k8s', async () => {
    stubUpstream(json({}));
    const res = await makeApp().request('/etc/passwd');
    expect(res.status).toBe(404);
    expect(upstreamCalls).toHaveLength(0);
  });
});
