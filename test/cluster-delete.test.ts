import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteClusterPolicies, isManagedPolicy, type ClusterPolicyRef } from '@/lib/cluster-api';

/**
 * Best-effort batch delete: each ref DELETEs sequentially, 404 counts as
 * deleted (already gone), real failures land in the report without stopping
 * the remaining deletes.
 */

const ref = (kind: ClusterPolicyRef['kind'], name: string, namespace = 'default'): ClusterPolicyRef => ({
  kind,
  namespace,
  name,
});

type Call = { method: string; url: string };

let calls: Call[] = [];
let responder: (url: string) => Response = () => new Response(null, { status: 204 });

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ method: init.method ?? 'GET', url });
      return responder(url);
    }),
  );
}

describe('isManagedPolicy', () => {
  it('detects Fleet and Helm markers the way they are actually stamped', () => {
    const cases: Array<[Record<string, unknown>, boolean]> = [
      // Fleet label/annotation prefixes.
      [{ metadata: { labels: { 'fleet.cattle.io/managed': 'true' } } }, true],
      [{ metadata: { annotations: { 'fleet.cattle.io/apply-N-init': 'x' } } }, true],
      // Helm hook resources carry the bare helm.sh/ prefix.
      [{ metadata: { annotations: { 'helm.sh/hook': 'pre-install' } } }, true],
      // Helm 3 release stamps — the common case.
      [{ metadata: { annotations: { 'meta.helm.sh/release-name': 'my-release' } } }, true],
      [{ metadata: { labels: { 'app.kubernetes.io/managed-by': 'Helm' } } }, true],
      // managed-by with another value is NOT Helm management.
      [{ metadata: { labels: { 'app.kubernetes.io/managed-by': 'kubectl' } } }, false],
      [{ metadata: { labels: { app: 'web' } } }, false],
      [{ metadata: {} }, false],
      [{}, false],
    ];
    for (const [item, expected] of cases) {
      expect(isManagedPolicy(item)).toBe(expected);
    }
  });
});

describe('deleteClusterPolicies', () => {
  beforeEach(() => {
    calls = [];
    responder = () => new Response(null, { status: 204 });
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('DELETEs each ref at its namespaced path, in order', async () => {
    const refs = [ref('NetworkPolicy', 'a'), ref('CiliumNetworkPolicy', 'b', 'other')];
    const report = await deleteClusterPolicies(refs);
    expect(report.deleted).toBe(2);
    expect(report.failed).toHaveLength(0);
    expect(calls.map(c => c.method)).toEqual(['DELETE', 'DELETE']);
    expect(calls[0]!.url).toBe('/k8s/apis/networking.k8s.io/v1/namespaces/default/networkpolicies/a');
    expect(calls[1]!.url).toBe(
      '/k8s/apis/cilium.io/v2/namespaces/other/ciliumnetworkpolicies/b',
    );
  });

  it('counts a 404 as already deleted', async () => {
    responder = url => (url.includes('gone') ? new Response(null, { status: 404 }) : new Response(null, { status: 204 }));
    const report = await deleteClusterPolicies([ref('NetworkPolicy', 'gone')]);
    expect(report.deleted).toBe(1);
    expect(report.failed).toHaveLength(0);
  });

  it('keeps deleting after a real failure and reports it', async () => {
    responder = url => (url.includes('denied') ? new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 }) : new Response(null, { status: 204 }));
    const report = await deleteClusterPolicies([
      ref('NetworkPolicy', 'denied'),
      ref('NetworkPolicy', 'ok'),
    ]);
    expect(report.deleted).toBe(1);
    expect(report.failed).toEqual([
      { ref: ref('NetworkPolicy', 'denied'), message: 'forbidden' },
    ]);
    // The ok ref still got its DELETE.
    expect(calls.some(c => c.url.endsWith('/networkpolicies/ok'))).toBe(true);
  });

  it('reports a non-JSON failure body as the status text', async () => {
    responder = () => new Response('plain text error', { status: 500 });
    const report = await deleteClusterPolicies([ref('NetworkPolicy', 'boom')]);
    expect(report.deleted).toBe(0);
    // Node fetch leaves statusText empty — the fallback spells it out.
    expect(report.failed[0]!.message).toBe('HTTP 500');
  });
});
