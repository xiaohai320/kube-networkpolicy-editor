import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyClusterPolicy, policyResourcePath, getClusterPolicyYaml } from '@/lib/cluster-api';

/**
 * The kind → API-path table is the single source for list, fetch, apply and
 * delete. These tests lock the paths per kind — in particular the CCNP apply
 * path, which the pre-registry code collapsed into CNP and would have
 * PATCHed the wrong collection.
 */

const NP = (name: string) => ({
  apiVersion: 'networking.k8s.io/v1',
  kind: 'NetworkPolicy',
  metadata: { name, namespace: 'default' },
  spec: { podSelector: {}, policyTypes: ['Ingress'], ingress: [] },
});
const CNP = (name: string) => ({
  apiVersion: 'cilium.io/v2',
  kind: 'CiliumNetworkPolicy',
  metadata: { name, namespace: 'default' },
  spec: { endpointSelector: {} },
});
const CCNP = (name: string) => ({
  apiVersion: 'cilium.io/v2',
  kind: 'CiliumClusterwideNetworkPolicy',
  metadata: { name },
  spec: { endpointSelector: {} },
});

type Call = { method: string; url: string; body?: string };
let calls: Call[] = [];

function stubFetch(status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? init.body : undefined });
      return new Response(JSON.stringify({ kind: 'Status', metadata: {} }), { status });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls = [];
});

describe('policyResourcePath', () => {
  it('maps each kind to the apiserver spelling', () => {
    expect(policyResourcePath({ kind: 'NetworkPolicy', namespace: 'app', name: 'p' }))
      .toBe('apis/networking.k8s.io/v1/namespaces/app/networkpolicies/p');
    expect(policyResourcePath({ kind: 'CiliumNetworkPolicy', namespace: 'app', name: 'p' }))
      .toBe('apis/cilium.io/v2/namespaces/app/ciliumnetworkpolicies/p');
    // CCNPs are cluster-scoped: no namespace segment.
    expect(policyResourcePath({ kind: 'CiliumClusterwideNetworkPolicy', namespace: '', name: 'p' }))
      .toBe('apis/cilium.io/v2/ciliumclusterwidenetworkpolicies/p');
  });
});

describe('applyClusterPolicy kind routing', () => {
  it('applies a CCNP document against the clusterwide collection', async () => {
    stubFetch();
    const yaml = (await import('js-yaml')).dump(CCNP('clusterwide-1'), { forceQuotes: true });
    await applyClusterPolicy({ kind: 'CiliumClusterwideNetworkPolicy', namespace: '', name: 'clusterwide-1' }, yaml);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/k8s/apis/cilium.io/v2/ciliumclusterwidenetworkpolicies/clusterwide-1?');
    expect(calls[0]!.url).not.toContain('ciliumnetworkpolicies');
    expect(calls[0]!.method).toBe('PATCH');
  });

  it('applies NP and CNP documents to their own collections', async () => {
    stubFetch();
    const { dump } = await import('js-yaml');
    await applyClusterPolicy(
      { kind: 'NetworkPolicy', namespace: 'default', name: 'np1' },
      dump(NP('np1'), { forceQuotes: true }),
    );
    await applyClusterPolicy(
      { kind: 'CiliumNetworkPolicy', namespace: 'default', name: 'cnp1' },
      dump(CNP('cnp1'), { forceQuotes: true }),
    );
    expect(calls[0]!.url).toContain('/networkpolicies/np1?');
    expect(calls[1]!.url).toContain('/ciliumnetworkpolicies/cnp1?');
  });
});

describe('getClusterPolicyYaml', () => {
  it('GETs the ref through the same path table', async () => {
    stubFetch();
    await getClusterPolicyYaml({ kind: 'CiliumClusterwideNetworkPolicy', namespace: '', name: 'cc1' });
    expect(calls[0]!.url).toBe('/k8s/apis/cilium.io/v2/ciliumclusterwidenetworkpolicies/cc1');
    expect(calls[0]!.method).toBe('GET');
  });
});
