/**
 * Topology engine + adapter tests — the graph derivation is the only real
 * logic in the dashboard, so it is unit-tested exhaustively here, DOM-free.
 * The adapter (raw apiserver JSON → engine shape) is tested with REAL
 * apiserver spellings, so the engine cannot pass on shapes the cluster would
 * never send. Components get a mount-smoke in topology-dashboard.test.tsx.
 */

import { describe, expect, it } from 'vitest';
import {
  aggregatePods,
  buildTopologyGraph,
  cidrNodeId,
  edgeId,
  HOST_ID,
  KUBE_APISERVER_ID,
  nsNodeId,
  policiesForNamespace,
  policyDeniesAll,
  selectorMatches,
  workloadNodeId,
  WORLD_ID,
  type EngineEndpoint,
  type EngineSpec,
  type PolicyRef,
  type PodInfo,
} from '@/components/topology/topology-engine';
import { adaptPolicy } from '@/components/topology/topology-data';

const pod = (name: string, labels: Record<string, string> = {}, workload?: string): PodInfo => ({
  name,
  labels,
  ready: true,
  workload,
});

/** Engine-shaped spec for direct engine tests; positional sugar over the
    options object (selector, ingress, egress, enforcedIngress, enforcedEgress). */
const spec = (
  endpointSelector?: Record<string, string>,
  ingress: EngineEndpoint[] = [],
  egress: EngineEndpoint[] = [],
  enforcedIngress = false,
  enforcedEgress = false,
): EngineSpec => ({
  endpointSelector: { matchLabels: endpointSelector ?? {} },
  ingress,
  egress,
  enforcedIngress,
  enforcedEgress,
});

const toWorld: EngineEndpoint = { target: { kind: 'world' }, ports: '*' };
const toHost: EngineEndpoint = { target: { kind: 'host' }, ports: '*' };
const toApiserver: EngineEndpoint = { target: { kind: 'kube-apiserver' }, ports: '*' };
const toCidr = (cidr: string): EngineEndpoint => ({ target: { kind: 'cidr', cidr }, ports: '*' });
const toPod = (labels: Record<string, string>): EngineEndpoint => ({
  target: { kind: 'workload' }, podSelector: { matchLabels: labels }, ports: '*',
});
const toNs = (ns: string): EngineEndpoint => ({ target: { kind: 'namespace', namespace: ns }, ports: '*' });

const ref = (p: Partial<PolicyRef> & Pick<PolicyRef, 'specs'>): PolicyRef => ({
  kind: 'NetworkPolicy',
  namespace: 'app',
  name: 'p1',
  ...p,
});

describe('selectorMatches', () => {
  it('empty selector matches everything', () => {
    expect(selectorMatches({}, { a: 'b' })).toBe(true);
    expect(selectorMatches(undefined, {})).toBe(true);
  });

  it('matchLabels must be a subset', () => {
    expect(selectorMatches({ matchLabels: { app: 'web' } }, { app: 'web', tier: '1' })).toBe(true);
    expect(selectorMatches({ matchLabels: { app: 'web' } }, { app: 'api' })).toBe(false);
    expect(selectorMatches({ matchLabels: { app: 'web' } }, {})).toBe(false);
  });

  it('matchExpressions In / NotIn / Exists / DoesNotExist', () => {
    const labels = { tier: 'frontend' };
    expect(selectorMatches(
      { matchExpressions: [{ key: 'tier', operator: 'In', values: ['frontend', 'backend'] }] }, labels,
    )).toBe(true);
    expect(selectorMatches(
      { matchExpressions: [{ key: 'tier', operator: 'NotIn', values: ['backend'] }] }, labels,
    )).toBe(true);
    expect(selectorMatches(
      { matchExpressions: [{ key: 'tier', operator: 'Exists', values: [] }] }, labels,
    )).toBe(true);
    expect(selectorMatches(
      { matchExpressions: [{ key: 'tier', operator: 'DoesNotExist', values: [] }] }, labels,
    )).toBe(false);
  });
});

describe('aggregatePods', () => {
  it('groups by workload and aggregates readiness', () => {
    const nodes = aggregatePods([
      pod('web-1', {}, 'web'), pod('web-2', {}, 'web'),
      pod('db-1', {}, 'db'),
      { name: 'bare', labels: {}, ready: false },
    ]);
    expect(nodes.map(n => n.id)).toEqual([
      workloadNodeId('web'), workloadNodeId('db'), workloadNodeId('bare'),
    ]);
    const web = nodes[0]!;
    expect(web.count).toBe(2);
    expect(web.ready).toBe(true);
    expect(nodes.find(n => n.label === 'bare')?.ready).toBe(false);
  });
});

describe('policiesForNamespace', () => {
  it('keeps namespaced policies of the namespace and scoping CCNPs', () => {
    const all = [
      ref({ namespace: 'app', specs: [spec({})] }),
      ref({ namespace: 'other', specs: [spec({})] }),
      ref({ kind: 'CiliumClusterwideNetworkPolicy', namespace: '', specs: [spec({})] }),
      ref({
        kind: 'CiliumClusterwideNetworkPolicy', namespace: '',
        specs: [{ ...spec({}), namespaceSelector: { matchLabels: { team: 'x' } } }],
      }),
    ];
    const kept = policiesForNamespace(all, 'app', { team: 'y' });
    // Own NP + unscoped CCNP; the team:x CCNP does not match ns labels.
    expect(kept).toHaveLength(2);
    expect(policiesForNamespace(all, 'app', { team: 'x' })).toHaveLength(3);
  });
});

describe('adaptPolicy — raw apiserver spellings', () => {
  const K8S_EGRESS_TO_DB = {
    metadata: { name: 'web-egress', namespace: 'app' },
    spec: {
      podSelector: { matchLabels: { app: 'web' } },
      policyTypes: ['Egress'],
      egress: [{ to: [{ podSelector: { matchLabels: { app: 'db' } } }], ports: [{ port: 5432, protocol: 'TCP' }] }],
    },
  };

  it('adapts a real K8s NetworkPolicy: selector, rules, ports, enforcement', () => {
    const p = adaptPolicy(K8S_EGRESS_TO_DB, 'NetworkPolicy', 'app')!;
    expect(p.name).toBe('web-egress');
    expect(p.specs).toHaveLength(1);
    const s = p.specs[0]!;
    expect(s.endpointSelector).toEqual({ matchLabels: { app: 'web' } });
    expect(s.enforcedIngress).toBe(false); // policyTypes has only Egress
    expect(s.enforcedEgress).toBe(true);
    expect(s.egress).toEqual([{ target: { kind: 'workload' }, podSelector: { matchLabels: { app: 'db' } }, ports: '5432/TCP' }]);
    expect(s.ingress).toEqual([]);
  });

  it('K8s ipBlock peer → cidr endpoint', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: {
        podSelector: {},
        egress: [{ to: [{ ipBlock: { cidr: '10.0.0.0/8', except: ['10.1.0.0/16'] } }] }],
      },
    }, 'NetworkPolicy', 'app')!;
    expect(p.specs[0]!.egress[0]!.target).toEqual({ kind: 'cidr', cidr: '10.0.0.0/8' });
  });

  it('K8s namespaceSelector with kubernetes.io/metadata.name → namespace node', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: {
        podSelector: {},
        egress: [{ to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'monitoring' } } }] }],
      },
    }, 'NetworkPolicy', 'app')!;
    expect(p.specs[0]!.egress[0]!.target).toEqual({ kind: 'namespace', namespace: 'monitoring' });
  });

  it('K8s namespaceSelector {} (all namespaces) → unresolvable', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: {
        podSelector: {},
        egress: [{ to: [{ namespaceSelector: {} }] }],
      },
    }, 'NetworkPolicy', 'app')!;
    expect(p.specs[0]!.egress[0]!.target).toEqual({ kind: 'unresolvable' });
  });

  it('K8s ports-only rule (no from/to) → own-namespace peer', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: {
        podSelector: { matchLabels: { app: 'web' } },
        ingress: [{ from: [], ports: [{ port: 80 }] }],
      },
    }, 'NetworkPolicy', 'app')!;
    expect(p.specs[0]!.ingress[0]!.target).toEqual({ kind: 'workload' });
    expect(p.specs[0]!.ingress[0]!.ports).toBe('80/TCP');
  });

  it('K8s no policyTypes: direction with rules is enforced, the other is not', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: { podSelector: {}, ingress: [{ from: [{ podSelector: {} }] }] },
    }, 'NetworkPolicy', 'app')!;
    expect(p.specs[0]!.enforcedIngress).toBe(true);
    expect(p.specs[0]!.enforcedEgress).toBe(false);
  });

  it('adapts a real CiliumNetworkPolicy: k8s: prefixes, entities, CIDRs, FQDNs', () => {
    const p = adaptPolicy({
      metadata: { name: 'cilium-egress', namespace: 'app' },
      spec: {
        endpointSelector: { matchLabels: { 'k8s:app': 'web' } },
        egress: [
          {
            toEndpoints: [{ matchLabels: { 'k8s:app': 'db', 'io.kubernetes.pod.namespace': 'app' } }],
            toPorts: [{ ports: [{ port: 8080, protocol: 'TCP' }] }],
          },
          { toEntities: ['world'] },
          { toCIDR: ['1.1.1.1/32'] },
          { toFQDNs: [{ matchName: 'api.example.com' }] },
        ],
      },
    }, 'CiliumNetworkPolicy', 'app')!;
    const s = p.specs[0]!;
    expect(s.endpointSelector).toEqual({ matchLabels: { app: 'web' } }); // k8s: stripped
    expect(s.enforcedIngress).toBe(false);
    expect(s.enforcedEgress).toBe(true);
    const [db, world, cidr, fqdn] = s.egress;
    expect(db).toEqual({ target: { kind: 'workload' }, podSelector: { matchLabels: { app: 'db' } }, ports: '8080/TCP' });
    expect(world!.target).toEqual({ kind: 'world' });
    expect(cidr!.target).toEqual({ kind: 'cidr', cidr: '1.1.1.1/32' });
    expect(fqdn!.target).toEqual({ kind: 'world' }); // FQDN resolves to world
  });

  it('Cilium cross-namespace endpoint (io.kubernetes.pod.namespace) → namespace node', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: {
        endpointSelector: {},
        egress: [{ toEndpoints: [{ matchLabels: { 'k8s:app': 'prom', 'io.kubernetes.pod.namespace': 'monitoring' } }] }],
      },
    }, 'CiliumNetworkPolicy', 'app')!;
    expect(p.specs[0]!.egress[0]!.target).toEqual({ kind: 'namespace', namespace: 'monitoring' });
  });

  it('Cilium host entity → host node', () => {
    const p = adaptPolicy({
      metadata: { name: 'n', namespace: 'app' },
      spec: { endpointSelector: {}, egress: [{ toEntities: ['host'] }] },
    }, 'CiliumNetworkPolicy', 'app')!;
    expect(p.specs[0]!.egress[0]!.target).toEqual({ kind: 'host' });
  });

  it('Cilium specs[] multi-group are all captured', () => {
    const p = adaptPolicy({
      metadata: { name: 'multi', namespace: 'app' },
      specs: [
        { endpointSelector: { matchLabels: { 'k8s:app': 'a' } }, egress: [{ toEntities: ['world'] }] },
        { endpointSelector: { matchLabels: { 'k8s:app': 'b' } }, ingress: [{ fromEntities: ['host'] }] },
      ],
    }, 'CiliumNetworkPolicy', 'app')!;
    expect(p.specs).toHaveLength(2);
    expect(p.specs[0]!.egress[0]!.target).toEqual({ kind: 'world' });
    expect(p.specs[1]!.ingress[0]!.target).toEqual({ kind: 'host' });
  });

  it('CCNP namespaceSelector sibling key is lifted to the spec', () => {
    const p = adaptPolicy({
      metadata: { name: 'ccnp' },
      spec: {
        endpointSelector: { matchLabels: { 'k8s:app': 'web' }, namespaceSelector: { matchLabels: { team: 'x' } } },
        ingress: [{ fromEntities: ['world'] }],
      },
    }, 'CiliumClusterwideNetworkPolicy', 'app')!;
    expect(p!.specs[0]!.namespaceSelector).toEqual({ matchLabels: { team: 'x' } });
    expect(p!.specs[0]!.endpointSelector).toEqual({ matchLabels: { app: 'web' } });
  });

  it('Cilium ingress: [{}] deny marker yields enforcement with no allows', () => {
    const p = adaptPolicy({
      metadata: { name: 'deny', namespace: 'app' },
      spec: { endpointSelector: { matchLabels: { 'k8s:app': 'db' } }, ingress: [{}] },
    }, 'CiliumNetworkPolicy', 'app')!;
    const s = p.specs[0]!;
    expect(s.enforcedIngress).toBe(true);
    expect(s.ingress).toEqual([]);
  });
});

describe('buildTopologyGraph', () => {
  it('empty namespace: grey nodes, no edges, empty flag', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], []);
    expect(g.empty).toBe(true);
    expect(g.edges).toEqual([]);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]!.denyIngress).toBeUndefined();
  });

  it('namespace with policies but no pods: special endpoints still materialize', () => {
    const g = buildTopologyGraph('app', [], [
      ref({ specs: [spec({ app: 'web' }, [toWorld], [], true, false)] }),
    ]);
    expect(g.empty).toBe(false);
    expect(g.nodes.map(n => n.id)).toEqual([WORLD_ID]);
    expect(g.edges).toEqual([]); // no selected pods → no edges
  });

  it('egress to world draws a green edge workload → world', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({ specs: [spec({ app: 'web' }, [], [toWorld], false, true)] }),
    ]);
    expect(g.edges).toHaveLength(1);
    const e = g.edges[0]!;
    expect(e.source).toBe(workloadNodeId('web'));
    expect(e.target).toBe(WORLD_ID);
    expect(e.bidirectional).toBe(false);
    expect(e.policies[0]!.rules).toEqual(['*']);
  });

  it('ingress from world mirrors the edge direction', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({ specs: [spec({ app: 'web' }, [toWorld], [], true, false)] }),
    ]);
    const e = g.edges[0]!;
    expect(e.source).toBe(WORLD_ID);
    expect(e.target).toBe(workloadNodeId('web'));
  });

  it('host entity maps to the host node, kube-dns entity to kube-apiserver', () => {
    const pods = [pod('web-1', { app: 'web' }, 'web')];
    const g = buildTopologyGraph('app', pods, [
      ref({ name: 'a', specs: [spec({ app: 'web' }, [], [toHost], false, true)] }),
      ref({ name: 'b', specs: [spec({ app: 'web' }, [], [toApiserver], false, true)] }),
    ]);
    const targets = g.edges.map(e => e.target).sort();
    expect(targets).toEqual([HOST_ID, KUBE_APISERVER_ID]);
  });

  it('cidr peer creates a per-CIDR node with its detail', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({ specs: [spec({ app: 'web' }, [], [toCidr('10.0.0.0/8')], false, true)] }),
    ]);
    expect(g.nodes.map(n => n.id)).toContain(cidrNodeId('10.0.0.0/8'));
    const cidr = g.nodes.find(n => n.id === cidrNodeId('10.0.0.0/8'))!;
    expect(cidr.detail).toBe('10.0.0.0/8');
    expect(g.edges[0]!.target).toBe(cidrNodeId('10.0.0.0/8'));
  });

  it('own-namespace labels peer resolves to the matching workload node', () => {
    const g = buildTopologyGraph('app', [
      pod('web-1', { app: 'web' }, 'web'),
      pod('db-1', { app: 'db' }, 'db'),
    ], [
      // db's policy allows ingress FROM web (web→db) AND egress TO web
      // (db→web) — the pair admits BOTH directions across the two rules.
      ref({ namespace: 'app', name: 'db-peer-web', specs: [spec({ app: 'db' }, [toPod({ app: 'web' })], [toPod({ app: 'web' })], true, true)] }),
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.bidirectional).toBe(true);
    expect([g.edges[0]!.source, g.edges[0]!.target].sort()).toEqual(
      [workloadNodeId('db'), workloadNodeId('web')].sort(),
    );
  });

  it('heterogeneous pods under one workload: a policy matching only one pod still draws the edge', () => {
    const g = buildTopologyGraph('app', [
      pod('web-1', { app: 'web' }, 'web'),
      pod('web-2', { app: 'web', tier: '2' }, 'web'),
      pod('db-1', { app: 'db' }, 'db'),
    ], [
      ref({ specs: [spec({ app: 'web', tier: '2' }, [], [toPod({ app: 'db' })], false, true)] }),
    ]);
    // web's node carries BOTH label sets — the tier:2 pod matches, so the
    // web→db edge exists.
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.source).toBe(workloadNodeId('web'));
    expect(g.edges[0]!.target).toBe(workloadNodeId('db'));
  });

  it('cross-namespace peer creates a namespace node', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({ specs: [spec({ app: 'web' }, [], [toNs('monitoring')], false, true)] }),
    ]);
    expect(g.edges[0]!.target).toBe(nsNodeId('monitoring'));
    const nsNode = g.nodes.find(n => n.id === nsNodeId('monitoring'))!;
    expect(nsNode.type).toBe('namespace');
    expect(nsNode.detail).toBe('monitoring');
  });

  it('ports land in the edge provenance rules', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({ specs: [spec({ app: 'web' }, [], [{ ...toCidr('10.0.0.0/8'), ports: '5432/TCP' }], false, true)] }),
    ]);
    expect(g.edges[0]!.policies[0]!.rules).toEqual(['5432/TCP']);
  });

  it('multiple policies on one path merge provenance', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({ name: 'p1', specs: [spec({ app: 'web' }, [], [toWorld], false, true)] }),
      ref({ name: 'p2', specs: [spec({ app: 'web' }, [], [toWorld], false, true)] }),
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.policies.map(p => p.name)).toEqual(['p1', 'p2']);
  });

  it('A→B + B→A merge into one bidirectional edge', () => {
    const g = buildTopologyGraph('app', [
      pod('web-1', { app: 'web' }, 'web'),
      pod('db-1', { app: 'db' }, 'db'),
    ], [
      ref({ name: 'p1', specs: [spec({ app: 'web' }, [], [toPod({ app: 'db' })], false, true)] }),
      ref({ name: 'p2', specs: [spec({ app: 'db' }, [], [toPod({ app: 'web' })], false, true)] }),
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.bidirectional).toBe(true);
  });

  it('unselected pods get no edges and no badges', () => {
    const g = buildTopologyGraph('app', [
      pod('web-1', { app: 'web' }, 'web'),
      pod('other-1', { app: 'other' }, 'other'),
    ], [
      ref({ specs: [spec({ app: 'web' }, [], [toWorld], false, true)] }),
    ]);
    const other = g.nodes.find(n => n.label === 'other')!;
    expect(other.denyIngress).toBeUndefined();
    expect(other.denyEgress).toBeUndefined();
    expect(g.edges).toHaveLength(1); // only web → world
  });

  it('enforced-but-ruleless direction gets the deny badge; open direction does not', () => {
    const g = buildTopologyGraph('app', [pod('db-1', { app: 'db' }, 'db')], [
      // Both directions enforced; only egress carries an allow.
      ref({ specs: [spec({ app: 'db' }, [], [toWorld], true, true)] }),
    ]);
    const db = g.nodes.find(n => n.label === 'db')!;
    expect(db.denyIngress).toBe(true); // enforced, no ingress allows
    expect(db.denyEgress).toBeUndefined(); // enforced AND has allows
  });

  it('unenforced direction gets NO badge even with zero rules', () => {
    const g = buildTopologyGraph('app', [pod('db-1', { app: 'db' }, 'db')], [
      // policyTypes: [Egress] only — ingress is untouched by this policy.
      ref({ specs: [{ ...spec({ app: 'db' }, [], [toWorld], false, true) }] }),
    ]);
    const db = g.nodes.find(n => n.label === 'db')!;
    expect(db.denyIngress).toBeUndefined(); // ingress unenforced → no badge
    expect(db.denyEgress).toBeUndefined(); // egress enforced but has allows
  });

  it('default-deny both ways: deny badges, no edges', () => {
    const g = buildTopologyGraph('app', [pod('db-1', { app: 'db' }, 'db')], [
      ref({ specs: [spec({ app: 'db' }, [], [], true, true)] }),
    ]);
    const db = g.nodes.find(n => n.label === 'db')!;
    expect(db.denyIngress).toBe(true);
    expect(db.denyEgress).toBe(true);
    expect(g.edges).toHaveLength(0);
  });

  it('an open policy alongside a denying one lifts the badge', () => {
    const g = buildTopologyGraph('app', [pod('db-1', { app: 'db' }, 'db')], [
      ref({ name: 'deny', specs: [spec({ app: 'db' }, [], [], true, true)] }),
      ref({ name: 'open', specs: [{ ...spec({ app: 'db' }, [], [], false, false) }] }),
    ]);
    const db = g.nodes.find(n => n.label === 'db')!;
    // The open spec does not enforce either direction, so no badge.
    expect(db.denyIngress).toBeUndefined();
    expect(db.denyEgress).toBeUndefined();
  });

  it('CCNP contributes paths without namespaceSelector', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({
        kind: 'CiliumClusterwideNetworkPolicy',
        namespace: '',
        specs: [spec({ app: 'web' }, [], [toWorld], false, true)],
      }),
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.policies[0]!.kind).toBe('CiliumClusterwideNetworkPolicy');
  });

  it('CCNP with non-matching namespaceSelector is skipped', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({
        kind: 'CiliumClusterwideNetworkPolicy',
        namespace: '',
        specs: [{ ...spec({ app: 'web' }, [], [toWorld], false, true), namespaceSelector: { matchLabels: { team: 'x' } } }],
      }),
    ], { team: 'y' });
    expect(g.edges).toHaveLength(0);
  });

  it('CCNP with matching namespaceSelector contributes', () => {
    const g = buildTopologyGraph('app', [pod('web-1', { app: 'web' }, 'web')], [
      ref({
        kind: 'CiliumClusterwideNetworkPolicy',
        namespace: '',
        specs: [{ ...spec({ app: 'web' }, [], [toWorld], false, true), namespaceSelector: { matchLabels: { team: 'x' } } }],
      }),
    ], { team: 'x' });
    expect(g.edges).toHaveLength(1);
  });
});

describe('edgeId', () => {
  it('is symmetric', () => {
    expect(edgeId('a', 'b')).toBe(edgeId('b', 'a'));
  });
});

describe('policyDeniesAll', () => {
  it('true only when the direction is enforced and ruleless in every spec', () => {
    expect(policyDeniesAll(ref({ specs: [spec({}, [], [], true, true)] }), 'ingress')).toBe(true);
    expect(policyDeniesAll(ref({ specs: [spec({}, [], [], true, true)] }), 'egress')).toBe(true);
    // Not enforced → not a deny, regardless of rule count.
    expect(policyDeniesAll(ref({ specs: [spec({}, [], [], false, false)] }), 'ingress')).toBe(false);
    // Enforced with allows → not a deny.
    expect(policyDeniesAll(ref({ specs: [spec({}, [toWorld], [], true, false)] }), 'ingress')).toBe(false);
    // Multi-spec: all must deny.
    expect(policyDeniesAll(ref({ specs: [spec({}, [], [], true, true), spec({}, [], [], true, true)] }), 'ingress')).toBe(true);
    expect(policyDeniesAll(ref({ specs: [spec({}, [], [], true, true), spec({}, [toWorld], [], true, false)] }), 'ingress')).toBe(false);
  });
});
