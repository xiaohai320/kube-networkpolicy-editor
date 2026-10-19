/**
 * Pure derivation of the topology dashboard's graph: pods + policies → nodes
 * and allowed-path edges. No DOM, no React, no fetches — the unit tests
 * exhaustively cover this module and only smoke-test the components that
 * consume it.
 */

/** One pod from the apiserver list, narrowed to the fields the board uses. */
export interface PodInfo {
  name: string;
  labels: Record<string, string>;
  /** Ready condition of the pod (all Running is not required). */
  ready: boolean;
  /** Owner workload the pod aggregates under; bare pods fall back to their name. */
  workload?: string;
}

/**
 * The label selector shape the engine speaks — `matchLabels` plus the four
 * expression operators the editor models. Policies feed in via
 * selectorsOf in topology-data.
 */
export interface EngineSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
}

/** One endpoint resolved by the adapter: a peer plus its allowed ports. */
export interface EngineEndpoint {
  /** What the peer resolves to on the board. */
  target:
    | { kind: 'workload' }
    | { kind: 'world' }
    | { kind: 'host' }
    | { kind: 'kube-apiserver' }
    | { kind: 'cidr'; cidr: string }
    | { kind: 'namespace'; namespace: string }
    | { kind: 'unresolvable' };
  /** `workload` targets match pods by these labels within the policy's scope. */
  podSelector?: EngineSelector;
  /** Namespace a `workload` target is scoped to (the board's ns or another). */
  namespace?: string;
  /** '*' = every namespace (cluster-wide peer, unresolvable on a per-ns board). */
  namespaceSelector?: EngineSelector;
  /** Human-readable port summary for the drawer. */
  ports: string;
}

/** One policy spec, in engine shape. */
export interface EngineSpec {
  endpointSelector: EngineSelector;
  /** CCNP-only namespace scope on the endpoint selector itself. */
  namespaceSelector?: EngineSelector;
  ingress: EngineEndpoint[];
  egress: EngineEndpoint[];
  /** Whether the direction is enforced at all (deny-by-default once selected). */
  enforcedIngress: boolean;
  enforcedEgress: boolean;
}

/** One policy, either namespaced or clusterwide, narrowed to what the engine needs. */
export interface PolicyRef {
  kind: 'NetworkPolicy' | 'CiliumNetworkPolicy' | 'CiliumClusterwideNetworkPolicy';
  namespace: string;
  name: string;
  specs: EngineSpec[];
}

/** The special endpoint flavors the board aggregates. */
export type SpecialKind = 'world' | 'host' | 'kube-apiserver' | 'cidr' | 'namespace';

/** A node in the topology graph. */
export interface TopologyNode {
  id: string;
  /** `workload` for pod nodes, otherwise the special-endpoint kind. */
  type: 'workload' | SpecialKind;
  /** Workload name (type=workload) or the special node's display key. */
  label: string;
  /** Pod count (workload nodes only). */
  count?: number;
  /** Aggregate readiness: true = every pod Ready, false = some not. */
  ready?: boolean;
  /** CIDR text for `cidr` nodes, namespace name for `namespace` nodes. */
  detail?: string;
  /** Default-deny badges: all ingress into / egress out of this pod is denied. */
  denyIngress?: boolean;
  denyEgress?: boolean;
}

/** Provenance: which policy allows this edge, and through which ports. */
export interface EdgeProvenance {
  kind: PolicyRef['kind'];
  namespace: string;
  name: string;
  rules: string[];
}

/** A green edge: at least one policy admits traffic on this path. */
export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  /** True when BOTH directions admit traffic (a plain arrow would lie). */
  bidirectional: boolean;
  policies: EdgeProvenance[];
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  /** True when the namespace holds no policy at all — the guided empty state. */
  empty: boolean;
}

/** Special node ids — stable across renders so layout diffing is trivial. */
export const WORLD_ID = 'special:world';
export const HOST_ID = 'special:host';
export const KUBE_APISERVER_ID = 'special:kube-apiserver';
export const cidrNodeId = (cidr: string): string => `special:cidr:${cidr}`;
export const nsNodeId = (ns: string): string => `special:ns:${ns}`;
/** Id of a workload node: the namespace is implicit (the board is per-ns). */
export const workloadNodeId = (workload: string): string => `workload:${workload}`;

/**
 * Group pods into aggregated nodes, keyed by owner workload (bare pods by
 * their own name). Readiness is aggregate: every pod Ready = green.
 */
export function aggregatePods(pods: PodInfo[]): TopologyNode[] {
  const byWorkload = new Map<string, PodInfo[]>();
  for (const pod of pods) {
    const key = pod.workload ?? pod.name;
    const list = byWorkload.get(key) ?? [];
    list.push(pod);
    byWorkload.set(key, list);
  }
  return [...byWorkload.entries()].map(([workload, list]) => ({
    id: workloadNodeId(workload),
    type: 'workload' as const,
    label: workload,
    count: list.length,
    ready: list.every(p => p.ready),
  }));
}

/**
 * True when the selector matches the given labels. An empty/missing selector
 * matches everything (K8s semantics). `matchExpressions` supports the four
 * operators the editor's authoring surface also offers.
 */
export function selectorMatches(
  selector: EngineSelector | undefined,
  labels: Record<string, string>,
): boolean {
  if (!selector) return true;
  const matchLabels = selector.matchLabels ?? {};
  for (const [key, value] of Object.entries(matchLabels)) {
    if (labels[key] !== value) return false;
  }
  for (const expr of selector.matchExpressions ?? []) {
    const present = Object.prototype.hasOwnProperty.call(labels, expr.key);
    const value = labels[expr.key] ?? '';
    const values = expr.values ?? [];
    switch (expr.operator) {
      case 'In':
        if (!present || !values.includes(value)) return false;
        break;
      case 'NotIn':
        if (present && values.includes(value)) return false;
        break;
      case 'Exists':
        if (!present) return false;
        break;
      case 'DoesNotExist':
        if (present) return false;
        break;
    }
  }
  return true;
}

/**
 * True when a selector is present but contentless — K8s's "match everything"
 * distinct from absent. Used for CCNP namespaceSelector semantics: `{}` means
 * every namespace, content must match.
 */
export function isEmptySelector(sel: EngineSelector | undefined): boolean {
  if (!sel) return false;
  return (
    Object.keys(sel.matchLabels ?? {}).length === 0 &&
    (sel.matchExpressions ?? []).length === 0
  );
}

/**
 * Which policies apply to a namespace: its own plus every CCNP whose
 * endpoint namespaceSelector (absent or empty = all) matches the ns labels.
 * Per-SPEC scoping for CCNPs: one spec may scope to `env=prod` namespaces
 * while a sibling spec of the same policy is unscoped — including the whole
 * policy because ANY spec matches would drag the unscoped spec's rules into
 * namespaces it never targeted. Kept specs are a filtered shallow copy, so
 * the caller's fetched data is never mutated.
 */
export function policiesForNamespace(
  all: PolicyRef[],
  namespace: string,
  nsLabels: Record<string, string> = {},
): PolicyRef[] {
  return all.flatMap(p => {
    if (p.kind !== 'CiliumClusterwideNetworkPolicy') return p.namespace === namespace ? [p] : [];
    const specs = p.specs.filter(spec => {
      const nsSel = spec.namespaceSelector;
      if (!nsSel || isEmptySelector(nsSel)) return true;
      return selectorMatches(nsSel, nsLabels);
    });
    return specs.length > 0 ? [{ ...p, specs }] : [];
  });
}

/**
 * Build the graph for one namespace.
 *
 * Edge rule (spec): an edge exists iff ≥1 policy admits traffic on the path.
 * Policies that mention a pair without admitting produce nothing — denial is
 * the node's deny badge, never a red line.
 *
 * `nsLabels` are the namespace's own labels, for CCNP namespaceSelector
 * matching; pass {} when unavailable, which disables content-based CCNP scoping.
 */
export function buildTopologyGraph(
  namespace: string,
  pods: PodInfo[],
  allPolicies: PolicyRef[],
  nsLabels: Record<string, string> = {},
): TopologyGraph {
  const policies = policiesForNamespace(allPolicies, namespace, nsLabels);
  const workloadNodes = aggregatePods(pods);

  /** All pods' labels per workload node — a node is matched if ANY pod of it
      matches (the aggregation is per selector scope, so heterogeneous pods
      each get their own edges via their labels). */
  const podLabelsByNode = new Map<string, Array<Record<string, string>>>();
  for (const p of pods) {
    const id = workloadNodeId(p.workload ?? p.name);
    podLabelsByNode.set(id, [...(podLabelsByNode.get(id) ?? []), p.labels]);
  }

  if (policies.length === 0) {
    // Guided empty state: everything unrestricted — grey nodes, no edges,
    // no deny badges. `empty` drives the UI's explainer banner.
    return { nodes: workloadNodes, edges: [], empty: true };
  }

  const nodes: TopologyNode[] = [...workloadNodes];
  /**
   * Special endpoints seen so far, from edges AND from peers that select
   * nothing here (a world peer of a policy whose pod list is empty still
   * deserves its node — story 7). Workload nodes are never added here.
   */
  const specialNodes = new Map<string, TopologyNode>();
  const noteSpecial = (kind: EngineEndpoint['target']): void => {
    let id: string;
    let node: TopologyNode;
    switch (kind.kind) {
      case 'world': id = WORLD_ID; node = { id, type: 'world', label: 'world' }; break;
      case 'host': id = HOST_ID; node = { id, type: 'host', label: 'host' }; break;
      case 'kube-apiserver': id = KUBE_APISERVER_ID; node = { id, type: 'kube-apiserver', label: 'kube-apiserver' }; break;
      case 'cidr': id = cidrNodeId(kind.cidr); node = { id, type: 'cidr', label: kind.cidr, detail: kind.cidr }; break;
      case 'namespace': id = nsNodeId(kind.namespace); node = { id, type: 'namespace', label: kind.namespace, detail: kind.namespace }; break;
      default: return;
    }
    if (!specialNodes.has(id)) specialNodes.set(id, node);
  };

  const edges = new Map<string, TopologyEdge>();
  const ensureEdge = (
    source: string,
    target: string,
    ref: EdgeProvenance,
  ): void => {
    const id = edgeId(source, target);
    const existing = edges.get(id);
    if (existing) {
      mergeProvenance(existing.policies, ref);
      // The canonical id folds A→B and B→A together. Compare the DIRECTION
      // pair, not the endpoint names: two inserts may canonically order the
      // same way while admitting opposite directions (an ingress peer and an
      // egress peer between the same pods both spell source-first). Either
      // orientation disagreement means both directions admit.
      if (source !== existing.source || target !== existing.target) {
        existing.bidirectional = true;
      }
    } else {
      edges.set(id, { id, source, target, bidirectional: false, policies: [ref] });
    }
  };

  /** Resolve an endpoint's peer node ids for one target pod node. */
  const resolvePeer = (ep: EngineEndpoint, selfId: string): string[] => {
    switch (ep.target.kind) {
      case 'workload': {
        // Scoped to the board's namespace (the adapter resolves other-ns
        // peers to {kind:'namespace'} targets, so a workload target here is
        // always local). Match each candidate node against ALL of its pods'
        // labels — the aggregation spans selector scopes, so a policy may
        // legitimately reach only some pods of a workload node.
        return workloadNodes
          .filter(n => {
            if (n.id === selfId) return false;
            const labelsList = podLabelsByNode.get(n.id) ?? [];
            return labelsList.some(labels => selectorMatches(ep.podSelector, labels));
          })
          .map(n => n.id);
      }
      case 'world':
        noteSpecial(ep.target);
        return [WORLD_ID];
      case 'host':
        noteSpecial(ep.target);
        return [HOST_ID];
      case 'kube-apiserver':
        noteSpecial(ep.target);
        return [KUBE_APISERVER_ID];
      case 'cidr':
        noteSpecial(ep.target);
        return [cidrNodeId(ep.target.cidr)];
      case 'namespace':
        // Another namespace: one aggregated node per namespace (spec).
        if (ep.target.namespace === namespace) return []; // self-ns noise
        noteSpecial(ep.target);
        return [nsNodeId(ep.target.namespace)];
      case 'unresolvable':
        return [];
    }
  };

  for (const policy of policies) {
    const ref: EdgeProvenance = {
      kind: policy.kind,
      namespace: policy.namespace,
      name: policy.name,
      rules: [],
    };
    for (const spec of policy.specs) {
      const sel = spec.endpointSelector;
      const selected = workloadNodes.filter(n =>
        (podLabelsByNode.get(n.id) ?? []).some(labels => selectorMatches(sel, labels)),
      );

      for (const node of selected) {
        for (const ep of spec.ingress) {
          for (const src of resolvePeer(ep, node.id)) {
            ensureEdge(src, node.id, { ...ref, rules: [ep.ports] });
          }
        }
        for (const ep of spec.egress) {
          for (const dst of resolvePeer(ep, node.id)) {
            ensureEdge(node.id, dst, { ...ref, rules: [ep.ports] });
          }
        }
      }

      // Special endpoints referenced by any rule materialize even when the
      // spec selects no pod here (story 7).
      for (const ep of [...spec.ingress, ...spec.egress]) {
        noteSpecial(ep.target);
      }
    }
  }

  // Default-deny badges: a workload node is deny-ingress when, among the
  // SPECS that actually select its pods, EVERY one enforces the direction
  // (K8s: policyTypes includes it; Cilium: a direction key is present) with
  // no allow rules. The check is per-spec, not per-policy: a policy can
  // carry both a denying spec (selecting this node) and a rule-carrying spec
  // (selecting other pods), and the latter must not hide the badge. A
  // direction that isn't enforced anywhere gets no badge — an egress-capable
  // pod must not read as egress-restricted.
  for (const node of nodes) {
    if (node.type !== 'workload') continue;
    const labelsList = podLabelsByNode.get(node.id) ?? [];
    const selectingSpecs = policies.flatMap(p =>
      p.specs.filter(s => labelsList.some(labels => selectorMatches(s.endpointSelector, labels))),
    );
    if (selectingSpecs.length === 0) continue;
    if (selectingSpecs.every(s => specDeniesAll(s, 'ingress'))) node.denyIngress = true;
    if (selectingSpecs.every(s => specDeniesAll(s, 'egress'))) node.denyEgress = true;
  }

  // Special endpoints join last so workload nodes keep their order; peers
  // that never produced an edge still materialize (story 7).
  nodes.push(...specialNodes.values());
  return { nodes, edges: [...edges.values()], empty: false };
}

/** True when a policy denies ALL traffic in one direction: every spec ENFORCES
    the direction (policyTypes / Cilium rule presence) and carries no allow
    rule for it. */
export function policyDeniesAll(p: PolicyRef, direction: 'ingress' | 'egress'): boolean {
  return p.specs.every(s => specDeniesAll(s, direction));
}

/** Spec-level deny-all: the direction is enforced (deny-by-default once
    selected) and no allow rule widens it. */
export function specDeniesAll(s: EngineSpec, direction: 'ingress' | 'egress'): boolean {
  const enforced = direction === 'ingress' ? s.enforcedIngress : s.enforcedEgress;
  const rules = direction === 'ingress' ? s.ingress : s.egress;
  return enforced && rules.length === 0;
}

/** Stable edge id, canonically ordered so A→B and B→A collide. */
export function edgeId(a: string, b: string): string {
  return a < b ? `edge:${a}~${b}` : `edge:${b}~${a}`;
}

/** Merge provenance entries for the same policy; union the port lists. */
function mergeProvenance(list: EdgeProvenance[], entry: EdgeProvenance): void {
  const found = list.find(
    p => p.kind === entry.kind && p.namespace === entry.namespace && p.name === entry.name,
  );
  if (found) {
    for (const r of entry.rules) if (!found.rules.includes(r)) found.rules.push(r);
  } else {
    list.push(entry);
  }
}
