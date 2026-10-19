import yaml from 'js-yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { ALL_NAMESPACES } from '@/lib/label-utils';
import { endpointSummary } from '@/lib/summarize';
import { ep, nextId, policy, PORT_HTTP, PORT_HTTPS, resetIds } from './helpers';

beforeAll(resetIds);

/** Parse a dumped document back so assertions are on structure, not formatting. */
function doc(text: string): Record<string, unknown> {
  return yaml.load(text) as Record<string, unknown>;
}

function specsOf(d: Record<string, unknown>): Record<string, unknown>[] {
  const spec = d.spec as Record<string, unknown> | undefined;
  const specs = d.specs as Record<string, unknown>[] | undefined;
  return specs ?? [spec ?? {}];
}

describe('generateCiliumYaml', () => {
  it('emits the CNP header', () => {
    const p = policy({ name: 'allow-web', namespace: 'production' });
    const d = doc(generateCiliumYaml(p));
    expect(d.apiVersion).toBe('cilium.io/v2');
    expect(d.kind).toBe('CiliumNetworkPolicy');
    expect(d.metadata).toMatchObject({ name: 'allow-web', namespace: 'production' });
  });

  it('emits an endpoint selector with the k8s: prefix', () => {
    const p = policy(
      { name: 'frontend' },
      { endpointSelector: { matchLabels: { app: 'frontend' } } },
    );
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.endpointSelector).toEqual({
      matchLabels: { 'k8s:app': 'frontend' },
    });
  });

  it('emits matchExpressions unchanged', () => {
    const p = policy({}, {
      endpointSelector: {
        matchExpressions: [{ key: 'env', operator: 'In', values: ['prod', 'staging'] }],
      },
    });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.endpointSelector).toEqual({
      matchExpressions: [{ key: 'k8s:env', operator: 'In', values: ['prod', 'staging'] }],
    });
  });

  it('maps an outside CIDR to fromCIDR', () => {
    const p = policy({}, {
      ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] })],
    });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.ingress).toEqual([
      { fromCIDR: ['10.0.0.0/8'], toPorts: [{ ports: [{ port: '80', protocol: 'TCP' }] }] },
    ]);
  });

  it('uses fromCIDRSet when the CIDR has exclusions', () => {
    const p = policy({}, {
      egress: [ep('cidr', 'outside', { cidr: '0.0.0.0/0', except: ['10.0.0.0/8'] })],
    });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.egress).toEqual([
      { toCIDRSet: [{ cidr: '0.0.0.0/0', except: ['10.0.0.0/8'] }] },
    ]);
  });

  it('maps group "outside" + all to the world entity', () => {
    const p = policy({}, { ingress: [ep('all', 'outside')] });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([{ fromEntities: ['world'] }]);
  });

  it('maps group "cluster" + all to the cluster entity', () => {
    const p = policy({}, { ingress: [ep('all', 'cluster')] });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([{ fromEntities: ['cluster'] }]);
  });

  it('names the policy namespace so a namespace-local all peer stays inside it', () => {
    // Cilium has no implicit namespace scoping, so `fromEndpoints: [{}]` would
    // match every endpoint in the cluster.
    const p = policy({}, { ingress: [ep('all', 'namespace')] });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      { fromEndpoints: [{ matchLabels: { 'io.kubernetes.pod.namespace': 'default' } }] },
    ]);
  });

  it('emits host and remote-node entities bare', () => {
    const p = policy({}, {
      egress: [
        ep('entity', 'cluster', { entity: 'host' }),
        ep('entity', 'cluster', { entity: 'remote-node' }),
      ],
    });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.egress).toEqual([{ toEntities: ['host'] }, { toEntities: ['remote-node'] }]);
  });

  it('emits kube-dns as a kube-dns entity, not a label selector', () => {
    const p = policy({}, { egress: [ep('kube-dns', 'cluster', { ports: [PORT_HTTP] })] });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.egress).toEqual([
      { toEntities: ['kube-dns'], toPorts: [{ ports: [{ port: '80', protocol: 'TCP' }] }] },
    ]);
  });

  it('emits FQDN as toFQDNs with matchName and matchPattern distinct', () => {
    const p = policy({}, {
      egress: [ep('fqdn', 'outside', { matchName: 'api.example.com', matchPattern: '*.internal' })],
    });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.egress).toEqual([
      { toFQDNs: [{ matchName: 'api.example.com', matchPattern: '*.internal' }] },
    ]);
  });

  it('omits an ingress side holding only FQDNs', () => {
    const p = policy({}, { ingress: [ep('fqdn', 'outside', { matchPattern: '*.example.com' })] });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    // The unrepresentable direction is omitted. The CRD's anyOf then requires
    // SOMETHING on the spec — the fallback emits allowAll wildcards, which
    // honestly allow all (the FQDN rule never existed in the direction anyway).
    // Only ingress gets the anyOf wildcard: emitting egress too would define
    // (enforce) egress the policy never had.
    expect(spec.ingress).toEqual([{}]);
    expect(spec.egress).toBeUndefined();
  });

  it('does not let an unrepresentable rule deny the rest of the direction', () => {
    const p = policy({}, {
      ingress: [
        ep('fqdn', 'outside', { matchPattern: '*.example.com' }),
        ep('all', 'namespace'),
      ],
    });
    // `ingress: [{}, {...}]` would be read back as deny-all ingress.
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      { fromEndpoints: [{ matchLabels: { 'io.kubernetes.pod.namespace': 'default' } }] },
    ]);
  });

  it('emits a cross-namespace labels peer with both namespace and pod labels', () => {
    const p = policy({}, {
      ingress: [
        ep('labels', 'cluster', {
          namespace: 'payments',
          podSelector: { app: 'api' },
          ports: [PORT_HTTPS],
        }),
      ],
    });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      {
        fromEndpoints: [{ matchLabels: { 'io.kubernetes.pod.namespace': 'payments', 'k8s:app': 'api' } }],
        toPorts: [{ ports: [{ port: '443', protocol: 'TCP' }] }],
      },
    ]);
  });

  it('emits namespace labels with the namespace-labels prefix', () => {
    const p = policy({}, {
      ingress: [ep('labels', 'cluster', { namespaceSelector: { 'kubernetes.io/metrics': 'enabled' } })],
    });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      {
        fromEndpoints: [
          { matchLabels: { 'io.kubernetes.pod.namespace.labels.kubernetes.io/metrics': 'enabled' } },
        ],
      },
    ]);
  });

  it('spells "all namespaces" as an Exists expression', () => {
    const p = policy({}, {
      ingress: [ep('labels', 'cluster', { namespace: ALL_NAMESPACES, podSelector: { app: 'api' } })],
    });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      {
        fromEndpoints: [
          {
            matchLabels: { 'k8s:app': 'api' },
            matchExpressions: [
              { key: 'io.kubernetes.pod.namespace', operator: 'Exists', values: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('emits a cluster-scoped labels peer as pod labels only', () => {
    const p = policy({}, { ingress: [ep('labels', 'cluster', { podSelector: { app: 'worker' } })] });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      { fromEndpoints: [{ matchLabels: { 'k8s:app': 'worker' } }] },
    ]);
  });

  it('names the policy namespace on a namespace-local labels peer', () => {
    // The same selector as above, but confined to the policy's own namespace.
    // Cilium cannot infer the namespace, so the label is written out.
    const p = policy({}, { ingress: [ep('labels', 'namespace', { podSelector: { app: 'worker' } })] });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.ingress).toEqual([
      {
        fromEndpoints: [
          { matchLabels: { 'io.kubernetes.pod.namespace': 'default', 'k8s:app': 'worker' } },
        ],
      },
    ]);
  });

  it('emits services via toServices', () => {
    const p = policy({}, {
      egress: [ep('service', 'namespace', { namespace: 'kube-system', serviceName: 'dns' })],
    });
    expect(specsOf(doc(generateCiliumYaml(p)))[0]!.egress).toEqual([
      { toServices: [{ k8sService: { namespace: 'kube-system', serviceName: 'dns' } }] },
    ]);
  });

  it('emits default-deny ingress via ingressDeny, not an allow wildcard', () => {
    const p = policy({}, { defaultDenyIngress: true });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    // `ingress: [{}]` is an allowAll rule in Cilium — the deny-all spelling
    // is an empty rule in ingressDeny, which also turns enforcement on.
    expect(spec.ingress).toBeUndefined();
    expect(spec.ingressDeny).toEqual([{}]);
    expect(spec.egress).toBeUndefined();
  });

  it('omits an untouched direction entirely', () => {
    const p = policy({}, { egress: [ep('all', 'outside')] });
    const spec = specsOf(doc(generateCiliumYaml(p)))[0]!;
    expect(spec.ingress).toBeUndefined();
  });

  it('uses `spec` for one group and `specs` for several', () => {
    const single = doc(generateCiliumYaml(policy({}, { egress: [ep('all', 'outside')] })));
    expect(single.spec).toBeDefined();
    expect(single.specs).toBeUndefined();

    const multi = policy({}, { egress: [ep('all', 'outside')] });
    multi.specs.push({
      id: nextId(),
      endpointSelector: { matchLabels: { app: 'backend' } },
      ingress: [],
      egress: [ep('all', 'outside')],
      defaultDenyIngress: false,
      defaultDenyEgress: false,
    });
    const d = doc(generateCiliumYaml(multi));
    expect(d.spec).toBeUndefined();
    expect((d.specs as unknown[]).length).toBe(2);
  });

  it('re-emits unsupported rules verbatim', () => {
    const l7Rules: Record<string, unknown> = {
      tls: [{ method: 'sni' }],
      http: [{ method: 'header' }],
      dns: [{ matchPattern: '*.example.com' }],
      contexts: [{}],
    };
    const raw: Record<string, unknown> = {
      toPorts: [{ ports: [{ port: '443', protocol: 'TCP' }], rules: l7Rules }],
    };
    const p = policy({}, { egress: [ep('all', 'outside')] });
    p.unsupported = { ingress: [], egress: [raw] };
    const text = generateCiliumYaml(p);
    expect(text).toContain('matchPattern: "*.example.com"');
    expect(text).toContain('# preserved: this editor cannot represent these egress rules');
  });

  it('keeps preserved rules alongside generated ones in valid YAML', () => {
    const p = policy({}, { egress: [ep('all', 'outside')] });
    p.unsupported = {
      ingress: [],
      egress: [{ toFQDNs: [{ matchPattern: '*.example.com' }] }],
    };
    const text = generateCiliumYaml(p);
    const parsed = yaml.load(text) as Record<string, unknown>;
    expect(parsed.kind).toBe('CiliumNetworkPolicy');
    const egress = (parsed.spec as Record<string, unknown>).egress as unknown[];
    expect(egress.length).toBe(2);
    expect(egress[1]).toEqual({ toFQDNs: [{ matchPattern: '*.example.com' }] });
  });

  it('writes stable, single-line YAML', () => {
    const p = policy({}, { ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] });
    const text = generateCiliumYaml(p);
    expect(text.split('\n').every(line => line.length <= 200)).toBe(true);
    expect(generateCiliumYaml(policy({}, { ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] }))).toBe(text);
  });
});

describe('generateK8sYaml', () => {
  it('emits the KNP header', () => {
    const d = doc(generateK8sYaml(policy({ name: 'k', namespace: 'ns1' })));
    expect(d.apiVersion).toBe('networking.k8s.io/v1');
    expect(d.kind).toBe('NetworkPolicy');
    expect(d.metadata).toMatchObject({ name: 'k', namespace: 'ns1' });
  });

  it('omits an empty podSelector as {}', () => {
    const d = doc(generateK8sYaml(policy()));
    expect((d.spec as Record<string, unknown>).podSelector).toEqual({});
  });

  it('emits a pod selector with matchExpressions', () => {
    const p = policy({}, {
      endpointSelector: {
        matchLabels: { app: 'web' },
        matchExpressions: [{ key: 'tier', operator: 'In', values: ['front'] }],
      },
    });
    const spec = doc(generateK8sYaml(p)).spec as Record<string, unknown>;
    expect(spec.podSelector).toEqual({
      matchLabels: { app: 'web' },
      matchExpressions: [{ key: 'tier', operator: 'In', values: ['front'] }],
    });
  });

  it('maps outside + all to 0.0.0.0/0', () => {
    const p = policy({}, { ingress: [ep('all', 'outside', { ports: [PORT_HTTP] })] });
    const spec = doc(generateK8sYaml(p)).spec as Record<string, unknown>;
    expect(spec.ingress).toEqual([
      { from: [{ ipBlock: { cidr: '0.0.0.0/0' } }], ports: [{ port: 80, protocol: 'TCP' }] },
    ]);
    expect(spec.policyTypes).toContain('Ingress');
  });

  it('maps a specific CIDR to ipBlock', () => {
    const p = policy({}, { ingress: [ep('cidr', 'outside', { cidr: '192.168.1.0/24' })] });
    expect(
      (doc(generateK8sYaml(p)).spec as Record<string, unknown>).ingress,
    ).toEqual([{ from: [{ ipBlock: { cidr: '192.168.1.0/24' } }] }]);
  });

  it('maps group "namespace" + all to a bare podSelector', () => {
    // A peer with no namespaceSelector stays inside the policy's own namespace.
    const p = policy({}, { egress: [ep('all', 'namespace')] });
    expect((doc(generateK8sYaml(p)).spec as Record<string, unknown>).egress).toEqual([
      { to: [{ podSelector: {} }] },
    ]);
  });

  it('maps group "cluster" + all to an empty namespaceSelector', () => {
    const p = policy({}, { egress: [ep('all', 'cluster')] });
    expect((doc(generateK8sYaml(p)).spec as Record<string, unknown>).egress).toEqual([
      { to: [{ namespaceSelector: {} }] },
    ]);
  });

  it('maps a cross-namespace labels peer to namespaceSelector + podSelector', () => {
    const p = policy({}, {
      egress: [
        ep('labels', 'cluster', {
          namespace: 'payments',
          podSelector: { app: 'api' },
          podExpressions: [{ key: 'tier', operator: 'In', values: ['back'] }],
        }),
      ],
    });
    expect((doc(generateK8sYaml(p)).spec as Record<string, unknown>).egress).toEqual([
      {
        to: [
          {
            namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'payments' } },
            podSelector: { matchLabels: { app: 'api' }, matchExpressions: [{ key: 'tier', operator: 'In', values: ['back'] }] },
          },
        ],
      },
    ]);
  });

  it('spells all namespaces as an empty namespaceSelector', () => {
    const p = policy({}, {
      ingress: [ep('labels', 'cluster', { namespace: ALL_NAMESPACES, podSelector: { app: 'api' } })],
    });
    expect((doc(generateK8sYaml(p)).spec as Record<string, unknown>).ingress).toEqual([
      { from: [{ namespaceSelector: {}, podSelector: { matchLabels: { app: 'api' } } }] },
    ]);
  });

  it('maps a namespace-local labels peer to a podSelector alone', () => {
    const p = policy({}, { ingress: [ep('labels', 'namespace', { podSelector: { app: 'worker' } })] });
    expect((doc(generateK8sYaml(p)).spec as Record<string, unknown>).ingress).toEqual([
      { from: [{ podSelector: { matchLabels: { app: 'worker' } } }] },
    ]);
  });

  it('maps kube-dns to a kube-system namespace + k8s-app pod selector', () => {
    const p = policy({}, { egress: [ep('kube-dns', 'cluster')] });
    expect((doc(generateK8sYaml(p)).spec as Record<string, unknown>).egress).toEqual([
      {
        to: [
          {
            namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
            podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
          },
        ],
      },
    ]);
  });

  it('drops FQDN rules rather than widening them to 0.0.0.0/0', () => {
    const p = policy({}, { egress: [ep('fqdn', 'outside', { matchPattern: '*.example.com' })] });
    const spec = doc(generateK8sYaml(p)).spec as Record<string, unknown>;
    // The direction stays explicit and denied; an absent field would allow-all.
    expect(spec.policyTypes).toContain('Egress');
    expect(spec.egress).toEqual([]);
    const text = generateK8sYaml(p);
    expect(text).toContain('# omitted: this egress rule cannot be expressed in a Kubernetes NetworkPolicy');
    expect(text).not.toContain('0.0.0.0/0');
  });

  it('warns about entity rules on the K8s side', () => {
    const p = policy({}, { egress: [ep('entity', 'cluster', { entity: 'host' })] });
    expect(generateK8sYaml(p)).toContain('# omitted:');
  });

  it('keeps the output valid YAML when representable and dropped rules mix', () => {
    const p = policy({}, {
      egress: [
        ep('all', 'cluster'),
        ep('fqdn', 'outside', { matchName: 'api.example.com' }),
      ],
    });
    const text = generateK8sYaml(p);
    // A bare comment as a list item would not parse: the note must sit above the key.
    const spec = yaml.load(text) as Record<string, Record<string, unknown>>;
    expect(spec.spec?.egress).toEqual([{ to: [{ namespaceSelector: {} }] }]);
    expect(text.split('\n').findIndex(l => l.includes('# omitted:'))).toBeLessThan(
      text.split('\n').findIndex(l => l.trim() === 'egress:'),
    );
  });

  it('emits default-deny through policyTypes only', () => {
    const p = policy({}, { defaultDenyIngress: true, defaultDenyEgress: true });
    const spec = doc(generateK8sYaml(p)).spec as Record<string, unknown>;
    expect(spec.policyTypes).toEqual(['Ingress', 'Egress']);
    expect(spec.ingress).toBeUndefined();
    expect(spec.egress).toBeUndefined();
  });

  it('pins ingress open when nothing is restricted (policyTypes defaulting guard)', () => {
    const spec = doc(generateK8sYaml(policy())).spec as Record<string, unknown>;
    // An omitted policyTypes is defaulted to [Ingress] by the apiserver,
    // which would deny all ingress. The generator pins an explicit allow-all
    // ingress rule instead.
    expect(spec.policyTypes).toEqual(['Ingress']);
    // A peerless rule — `ingress: [{}]` — allows every source; verified live
    // against the apiserver (stored verbatim, traffic flows).
    expect(spec.ingress).toEqual([{}]);
  });

  it('exports several specs as a multi-document stream', () => {
    const p = policy({}, { egress: [ep('all', 'cluster')] });
    p.specs.push({
      id: nextId(),
      endpointSelector: { matchLabels: { app: 'backend' } },
      ingress: [],
      egress: [ep('all', 'cluster')],
      defaultDenyIngress: false,
      defaultDenyEgress: false,
    });
    const text = generateK8sYaml(p);
    expect(text.split('\n---\n').length).toBe(2);
    expect(text).toContain('name: "my-network-policy-1"');
    expect(text).toContain('name: "my-network-policy-2"');
  });

  it('does not invent a name when there is one spec', () => {
    const p = policy({ name: 'just-one' });
    expect(generateK8sYaml(p)).toContain('name: "just-one"');
  });
});

describe('endpointSummary', () => {
  it('covers every kind', () => {
    expect(endpointSummary(ep('all', 'outside'))).toEqual({ key: 'endpoint-any-endpoint' });
    expect(endpointSummary(ep('cidr', 'outside', { cidr: '10.0.0.0/8' }))).toEqual({
      key: 'endpoint-cidr',
      params: { value: '10.0.0.0/8' },
    });
    expect(endpointSummary(ep('fqdn', 'outside', { matchPattern: '*.x.io' }))).toEqual({
      key: 'endpoint-fqdn',
      params: { value: '*.x.io' },
    });
    expect(endpointSummary(ep('entity', 'cluster', { entity: 'host' }))).toEqual({
      key: 'endpoint-entity',
      params: { value: 'host' },
    });
    expect(endpointSummary(ep('kube-dns', 'cluster'))).toEqual({ key: 'endpoint-kube-dns' });
    expect(endpointSummary(ep('service', 'namespace', { namespace: 'k', serviceName: 'dns' }))).toEqual({
      key: 'endpoint-service-names',
      params: { namespace: 'k', name: 'dns' },
    });
    expect(endpointSummary(ep('labels', 'namespace', { podSelector: { app: 'x' } }))).toEqual({
      key: 'endpoint-labels',
      params: { body: 'app=x' },
    });
  });

  it('falls back to the group default when a labels peer has no selector', () => {
    expect(endpointSummary(ep('labels', 'namespace'))).toEqual({ key: 'endpoint-any-pod' });
    expect(endpointSummary(ep('labels', 'cluster', { namespace: ALL_NAMESPACES }))).toEqual({
      key: 'endpoint-any-pod-all-namespaces',
    });
  });

  it('names the namespace when a labels peer is scoped to one', () => {
    expect(endpointSummary(ep('labels', 'cluster', { namespace: 'backend', podSelector: { app: 'api' } }))).toEqual({
      key: 'endpoint-labels-ns',
      params: { namespace: 'backend', body: 'app=api' },
    });
  });

  it('reports a namespace-qualified service and a bare selector one', () => {
    expect(endpointSummary(ep('service', 'namespace', { selector: { app: 'api' } }))).toEqual({
      key: 'endpoint-labels',
      params: { body: 'app=api' },
    });
  });
});
