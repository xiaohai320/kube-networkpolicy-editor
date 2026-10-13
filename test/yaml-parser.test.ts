import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import type { Policy } from '@/types/policy';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { PolicyParseError, detectAndParse } from '@/lib/yaml-parser';
import { specByGroup, withoutIds } from './helpers';

function fixture(name: string): string {
  return readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
}

function parseFixture(name: string): Policy {
  return detectAndParse(fixture(name)).policy;
}

describe('Kubernetes NetworkPolicy fixtures', () => {
  it('detects the format and metadata', () => {
    const p = parseFixture('allow-web-with-http.yaml');
    expect(p).toMatchObject({ name: 'allow-web-with-http', namespace: 'foo', format: 'k8s' });
    expect(p.specs).toHaveLength(1);
  });

  it('keeps the pod selector, including matchLabels', () => {
    const spec = parseFixture('allow-web-with-http.yaml').specs[0]!;
    expect(spec.endpointSelector).toEqual({ matchLabels: { app: 'my-app' } });
  });

  it('reads policyTypes as default-deny flags', () => {
    const spec = parseFixture('allow-web-with-http.yaml').specs[0]!;
    // Both directions carry rules, so neither is a ruleless deny-all.
    expect(spec.defaultDenyIngress).toBe(false);
    expect(spec.defaultDenyEgress).toBe(false);
    expect(spec.ingress.length).toBeGreaterThan(0);
    expect(spec.egress.length).toBeGreaterThan(0);
  });

  it('splits one rule carrying several peers into several endpoints', () => {
    const spec = parseFixture('allow-web-with-http.yaml').specs[0]!;
    expect(withoutIds(spec.ingress)).toEqual([
      { group: 'outside', kind: 'cidr', cidr: '172.17.0.0/16', ports: [{ port: 80, protocol: 'TCP' }] },
      {
        // A bare `podSelector` never leaves the policy's own namespace.
        group: 'namespace',
        kind: 'labels',
        podSelector: { security: 'my-team' },
        ports: [{ port: 80, protocol: 'TCP' }],
      },
    ]);
    expect(withoutIds(spec.egress)).toEqual([
      { group: 'outside', kind: 'cidr', cidr: '172.17.0.0/16', ports: [{ port: 443, protocol: 'TCP' }] },
      {
        group: 'namespace',
        kind: 'labels',
        podSelector: { security: 'my-team' },
        ports: [{ port: 443, protocol: 'TCP' }],
      },
    ]);
  });

  it('round-trips a parsed K8s policy back to YAML', () => {
    const p = parseFixture('allow-web-with-http.yaml');
    expect(withoutIds(generateK8sYamlText(p))).toEqual(withoutIds(p));
  });
});

describe('CiliumNetworkPolicy fixtures', () => {
  it('normalizes the endpoint selector back to bare pod labels', () => {
    const spec = parseFixture('allow-egress-dns.yaml').specs[0]!;
    expect(spec.endpointSelector).toEqual({
      matchExpressions: [{ key: 'app', operator: 'In', values: ['app1'] }],
    });
  });

  it('reads the kube-dns entity with its ports', () => {
    const spec = parseFixture('allow-egress-dns.yaml').specs[0]!;
    expect(withoutIds(spec.egress)).toEqual([
      {
        group: 'cluster',
        kind: 'kube-dns',
        ports: [
          { port: 53, protocol: 'UDP' },
          { port: 53, protocol: 'TCP' },
        ],
      },
    ]);
  });

  it('parses FQDN, CIDRSet, host and namespace-scoped label peers', () => {
    const spec = parseFixture('allow-api-egress.yaml').specs[0]!;
    expect(spec.endpointSelector).toEqual({ matchLabels: { app: 'frontend' } });
    expect(withoutIds(spec.egress)).toEqual([
      {
        group: 'outside',
        kind: 'fqdn',
        matchName: 'api.example.com',
        ports: [{ port: 443, protocol: 'TCP' }],
      },
      {
        group: 'outside',
        kind: 'cidr',
        cidr: '0.0.0.0/0',
        except: ['10.0.0.0/8', '192.168.0.0/16'],
        ports: [],
      },
      { group: 'cluster', kind: 'entity', entity: 'host', ports: [] },
      {
        // A namespace other than the policy's own widens the peer to the cluster.
        group: 'cluster',
        kind: 'labels',
        namespace: 'kube-system',
        podSelector: { app: 'metrics' },
        podExpressions: [{ key: 'tier', operator: 'In', values: ['back'] }],
        ports: [],
      },
    ]);
  });

  it('round-trips a parsed Cilium policy back to YAML', () => {
    const p = parseFixture('allow-api-egress.yaml');
    expect(withoutIds(generateCiliumYamlText(p))).toEqual(withoutIds(p));
  });
});

describe('L7 rules are preserved rather than dropped', () => {
  it('moves an L7 rule into the unsupported bucket whole', () => {
    const p = parseFixture('allow-metrics-with-l7.yaml');
    // The peer and its L7 rules are kept together, so the entity is not
    // re-emitted separately and loses its association with the http match.
    expect(p.specs[0]!.egress).toEqual([]);
    expect(p.unsupported?.egress).toHaveLength(1);
    expect(JSON.stringify(p.unsupported?.egress)).toContain('"http"');
  });

  it('re-emits the preserved rule on export', () => {
    const p = parseFixture('allow-metrics-with-l7.yaml');
    const text = generateCiliumYaml(p);
    expect(text).toContain('matchPattern: "/metrics"');
    expect(text).toContain('# preserved:');
  });
});

describe('multi-document streams', () => {
  it('turns two NetworkPolicies into two selector groups', () => {
    const p = parseFixture('deny-all-except-dns.yaml');
    expect(p.specs).toHaveLength(2);
    // A direction that carries rules is already denied by default in Kubernetes,
    // so the model keeps its deny flag unset and re-emits `policyTypes`.
    expect(p.specs[0]!.defaultDenyEgress).toBe(false);
    expect(p.specs[0]!.egress.length).toBe(2);
    expect(p.specs[1]!.defaultDenyIngress).toBe(false);
    expect(p.specs[1]!.defaultDenyEgress).toBe(false);
  });

  it('re-emits the policyTypes a restricted direction needs', () => {
    const p = parseFixture('deny-all-except-dns.yaml');
    const docs = yaml.loadAll(generateK8sYaml(p)) as Array<Record<string, Record<string, unknown>>>;
    expect(docs[0]!.spec?.policyTypes).toEqual(['Egress']);
    expect(docs[1]!.spec?.policyTypes).toEqual(['Ingress']);
  });

  it('parses the namespace name out of a namespaceSelector', () => {
    const spec = parseFixture('deny-all-except-dns.yaml').specs[0]!;
    expect(withoutIds(spec.egress)).toEqual([
      {
        group: 'outside',
        kind: 'cidr',
        cidr: '0.0.0.0/0',
        except: ['10.0.0.0/8'],
        ports: [
          { port: 53, protocol: 'UDP' },
          { port: 53, protocol: 'TCP' },
        ],
      },
      {
        group: 'cluster',
        kind: 'labels',
        namespace: 'monitoring',
        podSelector: { app: 'kube-dns' },
        ports: [
          { port: 53, protocol: 'UDP' },
          { port: 53, protocol: 'TCP' },
        ],
      },
    ]);
  });
});

describe('error handling', () => {
  it('rejects YAML that does not parse', () => {
    expect(() => detectAndParse('::: not yaml [')).toThrow(PolicyParseError);
  });

  it('rejects an empty document', () => {
    expect(() => detectAndParse('')).toThrow(/No policy found/);
  });

  it('rejects an unsupported kind', () => {
    expect(() => detectAndParse('kind: ConfigMap\nmetadata:\n  name: x')).toThrow(/Unsupported kind/);
  });

  it('rejects a stream mixing both policy kinds', () => {
    const mixed = fixture('allow-web-with-http.yaml') + '\n---\n' + fixture('allow-egress-dns.yaml');
    expect(() => detectAndParse(mixed)).toThrow(/Mixed policy kinds/);
  });
});

describe('group indexing', () => {
  it('places peers in the column that matches how far they reach', () => {
    const spec = parseFixture('allow-web-with-http.yaml').specs[0]!;
    // A bare `podSelector` never leaves the policy's own namespace, so it
    // lands in the namespace column, not the cluster one.
    const byGroup = specByGroup(spec.ingress);
    expect(byGroup.outside).toHaveLength(1);
    expect(byGroup.namespace).toHaveLength(1);
    expect(byGroup.cluster).toHaveLength(0);

    // A `namespaceSelector` is what pushes a peer into the cluster column.
    const dns = parseFixture('deny-all-except-dns.yaml').specs[0]!;
    const dnsByGroup = specByGroup(dns.egress);
    expect(dnsByGroup.outside).toHaveLength(1);
    expect(dnsByGroup.cluster).toHaveLength(1);
    expect(dnsByGroup.namespace).toHaveLength(0);
  });
});

/** Regenerate text then re-parse, so the comparison is model to model. */
function generateK8sYamlText(p: Policy): Policy {
  return detectAndParse(generateK8sYaml(p)).policy;
}

function generateCiliumYamlText(p: Policy): Policy {
  return detectAndParse(generateCiliumYaml(p)).policy;
}
