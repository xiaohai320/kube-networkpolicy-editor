/**
 * Cluster fetches + adaptation for the topology dashboard. Everything rides
 * the same `/k8s/*` passthrough as the rest of the cluster surface (ADR-0001)
 * — the backend adds nothing, the apiserver's RBAC is the gate.
 *
 * The adapter in this file is the load-bearing seam: the apiserver speaks
 * raw policy JSON (`podSelector`, `{ports, from[]}` rule pairs, `policyTypes`,
 * Cilium label prefixes), while the engine speaks the board's resolved shape.
 * Nothing here re-uses the editor's yaml-parser: that path is built for
 * round-tripping user-authored YAML (ids, unsupported-rule preservation) and
 * the board only needs selector + endpoint resolution.
 */

import { request } from '@/lib/cluster-api';
import {
  selectorMatches,
  type EngineEndpoint,
  type EngineSelector,
  type PolicyRef,
  type PodInfo,
} from './topology-engine';

interface RawPod {
  metadata?: { name?: string; labels?: Record<string, string> };
  status?: {
    phase?: string;
    conditions?: Array<{ type?: string; status?: string }>;
  };
}

/** True when the pod's Ready condition is True. */
function podReady(pod: RawPod): boolean {
  return (pod.status?.conditions ?? []).some(
    c => c.type === 'Ready' && c.status === 'True',
  );
}

/** One namespace's pods, narrowed to the engine's PodInfo. Finished pods
    (Job debug shells, completed init containers' hosts) are skipped: they
    hold no traffic, so a topology board only shows Running and Pending. */
export async function listPods(namespace: string): Promise<PodInfo[]> {
  const res = await request(`api/v1/namespaces/${namespace}/pods`);
  const items = ((await res.json()) as { items?: RawPod[] }).items ?? [];
  const live = items.filter(pod => {
    const phase = pod.status?.phase ?? '';
    return phase === 'Running' || phase === 'Pending' || phase === '';
  });
  return live.map(pod => ({
    name: pod.metadata?.name ?? '',
    labels: pod.metadata?.labels ?? {},
    ready: podReady(pod),
  }));
}

interface RawWorkload {
  metadata?: { name?: string };
  spec?: {
    selector?: {
      matchLabels?: Record<string, string>;
      matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
    };
  };
}

/**
 * Workloads of one namespace with their pod selectors — the aggregation key:
 * a pod belongs to the workload whose selector matches its labels.
 */
export interface WorkloadInfo {
  name: string;
  selector: EngineSelector;
}

/** Deployments / StatefulSets / DaemonSets of one namespace. */
export async function listWorkloads(namespace: string): Promise<WorkloadInfo[]> {
  const apis = [
    `apis/apps/v1/namespaces/${namespace}/deployments`,
    `apis/apps/v1/namespaces/${namespace}/statefulsets`,
    `apis/apps/v1/namespaces/${namespace}/daemonsets`,
  ];
  const lists = await Promise.all(
    apis.map(api =>
      request(api).then(r => r.json()).catch(() => ({ items: [] })),
    ),
  );
  const out: WorkloadInfo[] = [];
  for (const list of lists) {
    for (const item of (((list as { items?: RawWorkload[] }).items ?? []) as RawWorkload[])) {
      const name = item.metadata?.name;
      const selector = item.spec?.selector;
      if (!name || !selector) continue;
      // A selector with NO matchLabels and NO matchExpressions matches every
      // pod — legal for deployments but fatal as an aggregation key (it
      // swallows the whole namespace into one node). Such workloads are
      // skipped; their pods then aggregate under their own names.
      const hasContent =
        Object.keys(selector.matchLabels ?? {}).length > 0 ||
        (selector.matchExpressions ?? []).length > 0;
      if (!hasContent) continue;
      out.push({
        name,
        selector: { matchLabels: selector.matchLabels, matchExpressions: selector.matchExpressions },
      });
    }
  }
  return out;
}

interface RawK8sSpec {
  podSelector?: Record<string, unknown>;
  policyTypes?: string[];
  ingress?: RawK8sRule[];
  egress?: RawK8sRule[];
}

interface RawK8sRule {
  ports?: Array<{ port?: number | string; protocol?: string }>;
  from?: RawK8sPeer[];
  to?: RawK8sPeer[];
}

interface RawK8sPeer {
  podSelector?: Record<string, unknown>;
  namespaceSelector?: Record<string, unknown>;
  ipBlock?: { cidr?: string; except?: string[] };
}

interface RawCiliumSpec {
  endpointSelector?: Record<string, unknown>;
  ingress?: RawCiliumRule[];
  egress?: RawCiliumRule[];
  ingressDeny?: RawCiliumRule[];
  egressDeny?: RawCiliumRule[];
}

interface RawCiliumRule {
  fromEndpoints?: Array<Record<string, unknown>>;
  toEndpoints?: Array<Record<string, unknown>>;
  fromEntities?: string[];
  toEntities?: string[];
  fromCIDR?: string[];
  toCIDR?: string[];
  fromCIDRSet?: Array<{ cidr?: string; except?: string[] }>;
  toCIDRSet?: Array<{ cidr?: string; except?: string[] }>;
  toFQDNs?: Array<{ matchName?: string; matchPattern?: string }>;
  toPorts?: Array<{ ports?: Array<{ port?: number | string; protocol?: string }>; rules?: Record<string, unknown> }>;
  icmps?: unknown;
  authentication?: unknown;
}

const K8S_PREFIX = 'k8s:';
const NAMESPACE_LABEL = 'io.kubernetes.pod.namespace';
const NAMESPACE_LABELS_PREFIX = 'io.kubernetes.pod.namespace.labels.';
const NAMESPACE_NAME_LABEL = 'kubernetes.io/metadata.name';

/** Ports summary of a rule, in the drawer's `port/protocol` spelling.
    Handles both spellings: K8s `ports[]` is a flat `{port, protocol}` array;
    Cilium `toPorts[]` wraps them in `{ports: [...]}` groups. */
function portsSummary(input: unknown): string {
  const flat: Array<{ port?: number | string; protocol?: string }> = [];
  for (const group of (Array.isArray(input) ? input : []) as Array<Record<string, unknown>>) {
    const inner = group.ports;
    if (Array.isArray(inner)) {
      for (const one of inner as Array<Record<string, unknown>>) flat.push(one as { port?: number | string; protocol?: string });
    } else {
      flat.push(group as { port?: number | string; protocol?: string });
    }
  }
  const list: string[] = [];
  for (const one of flat) {
    if (one.port !== undefined) list.push(`${one.port}/${one.protocol ?? 'TCP'}`);
  }
  return list.length > 0 ? list.join(', ') : '*';
}

/** K8s LabelSelector JSON → EngineSelector. Namespace-name labels are kept:
 * the engine matches them against pod labels (namespace:default pods carry
 * `kubernetes.io/metadata.name` only when set, so the caller also matches
 * namespaceSelector against ns labels separately). */
function toEngineSelector(sel: Record<string, unknown> | undefined | null): EngineSelector {
  if (!sel) return {};
  const out: EngineSelector = {};
  const ml = sel.matchLabels as Record<string, string> | undefined;
  if (ml && Object.keys(ml).length > 0) out.matchLabels = { ...ml };
  const me = sel.matchExpressions as EngineSelector['matchExpressions'] | undefined;
  if (me && me.length > 0) out.matchExpressions = me.map(e => ({ ...e }));
  return out;
}

/**
 * Strip Cilium's `k8s:` prefix off a pod label key; drop the namespace
 * pseudo-labels — those ride on namespaceSelector in engine shape.
 */
function ciliumPodLabels(sel: Record<string, unknown> | undefined): EngineSelector {
  const out: EngineSelector = { matchLabels: {} };
  if (!sel) return out;
  for (const [k, v] of Object.entries((sel.matchLabels ?? {}) as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (k === NAMESPACE_LABEL || k.startsWith(NAMESPACE_LABELS_PREFIX)) continue;
    const key = k.startsWith(K8S_PREFIX) ? k.slice(K8S_PREFIX.length) : k;
    out.matchLabels![key] = String(v);
  }
  const exprs = (sel.matchExpressions ?? []) as Array<{ key: string; operator: string; values?: string[] }>;
  const mapped = exprs
    .filter(e => !e.key.startsWith(NAMESPACE_LABEL))
    .map(e => ({
      key: e.key.startsWith(K8S_PREFIX) ? e.key.slice(K8S_PREFIX.length) : e.key,
      operator: e.operator,
      values: e.values,
    }));
  if (mapped.length > 0) out.matchExpressions = mapped;
  if (Object.keys(out.matchLabels!).length === 0) delete out.matchLabels;
  return out;
}

/** True when a Cilium selector object carries namespace scope (the `io.kubernetes.pod.namespace` label forms). */
function ciliumNamespaceScope(sel: Record<string, unknown> | undefined): {
  namespace?: string;
  namespaceSelector?: EngineSelector;
  anyNamespace?: boolean;
} {
  if (!sel) return {};
  const out: { namespace?: string; namespaceSelector?: EngineSelector; anyNamespace?: boolean } = {};
  for (const [k, v] of Object.entries((sel.matchLabels ?? {}) as Record<string, unknown>)) {
    if (k === NAMESPACE_LABEL && typeof v === 'string') {
      out.namespace = v;
    } else if (k.startsWith(NAMESPACE_LABELS_PREFIX)) {
      (out.namespaceSelector ??= { matchLabels: {} }).matchLabels![k.slice(NAMESPACE_LABELS_PREFIX.length)] = String(v);
    }
  }
  const exprs = (sel.matchExpressions ?? []) as Array<{ key: string; operator: string; values?: string[] }>;
  for (const e of exprs) {
    if (e.key === NAMESPACE_LABEL || e.key.startsWith(NAMESPACE_LABELS_PREFIX)) {
      // `namespace Exists` (no values) is Cilium's all-namespaces marker.
      if (e.key === NAMESPACE_LABEL && (e.operator === 'Exists' || (e.values ?? []).length === 0)) {
        out.anyNamespace = true;
      } else {
        (out.namespaceSelector ??= { matchExpressions: [] }).matchExpressions!.push(e);
      }
    }
  }
  return out;
}

/** Sole namespace name from a `kubernetes.io/metadata.name In [x]`
    matchExpression, if present. Multiple values target several namespaces —
    not drawable as one node — so they stay unresolvable. */
function matchExpressionName(
  exprs: Array<{ key: string; operator: string; values?: string[] }> | undefined,
): string | undefined {
  const e = exprs?.find(
    x => x.key === NAMESPACE_NAME_LABEL && x.operator === 'In' && (x.values?.length ?? 0) === 1,
  );
  return e?.values?.[0];
}

/** Map one K8s peer to an engine endpoint (or undefined when unresolvable). */
function k8sPeerToEndpoint(peer: RawK8sPeer, boardNamespace: string): EngineEndpoint | undefined {
  const ipBlock = peer.ipBlock;
  if (ipBlock?.cidr) {
    return { target: { kind: 'cidr', cidr: ipBlock.cidr }, ports: '' };
  }
  const podSel = toEngineSelector(peer.podSelector);
  const nsSel = toEngineSelector(peer.namespaceSelector);

  if (peer.namespaceSelector !== undefined) {
    // Namespace-scoped peer. `namespaceSelector: {}` = every namespace —
    // not drawable as one node on a per-namespace board.
    // The namespace name can also arrive as a matchExpression —
    // `kubernetes.io/metadata.name In [x]` — the common authoring spelling
    // from label pickers; a single In value resolves just like the label.
    const name = nsSel.matchLabels?.[NAMESPACE_NAME_LABEL] ?? matchExpressionName(nsSel.matchExpressions);
    const hasContent = Object.keys(nsSel.matchLabels ?? {}).length > 1 ||
      (nsSel.matchExpressions ?? []).length > 0;
    if (!name && hasContent) return undefined;
    const namespace = name ?? (hasContent ? undefined : '*');
    if (namespace === '*' || !namespace) {
      // `{}` (every namespace) or label-scoped namespaces: nothing drawable
      // on a per-namespace board — explicit unresolvable, no edge.
      return { target: { kind: 'unresolvable' }, ports: '' };
    }
    if (namespace === boardNamespace) {
      return { target: { kind: 'workload' }, podSelector: podSel, ports: '' };
    }
    return { target: { kind: 'namespace', namespace }, ports: '' };
  }

  // No namespaceSelector: the peer is in the policy's own namespace.
  return { target: { kind: 'workload' }, podSelector: podSel, ports: '' };
}

/** Map one Cilium endpoint selector to an engine endpoint. */
function ciliumEndpointToEndpoint(sel: Record<string, unknown> | undefined, boardNamespace: string): EngineEndpoint | undefined {
  const scope = ciliumNamespaceScope(sel);
  const podSelector = ciliumPodLabels(sel);
  if (scope.anyNamespace) {
    return undefined; // all-namespaces peer: not drawable locally
  }
  if (scope.namespace) {
    if (scope.namespace === boardNamespace) {
      return { target: { kind: 'workload' }, podSelector, ports: '' };
    }
    return { target: { kind: 'namespace', namespace: scope.namespace }, ports: '' };
  }
  if (scope.namespaceSelector && Object.keys(scope.namespaceSelector.matchLabels ?? {}).length + (scope.namespaceSelector.matchExpressions ?? []).length > 0) {
    return undefined; // label-scoped namespaces: not drawable locally
  }
  return { target: { kind: 'workload' }, podSelector, ports: '' };
}

/** Map Cilium entities. Only the ones with board nodes resolve. */
function ciliumEntityToTarget(entity: string): EngineEndpoint['target'] | undefined {
  switch (entity) {
    case 'world':
    case 'unmanaged': // external IPs Cilium doesn't manage — world-side
      return { kind: 'world' };
    case 'host':
      return { kind: 'host' };
    case 'kube-apiserver':
      return { kind: 'kube-apiserver' };
    case 'cluster': // any in-cluster endpoint — nameless, not drawable
    case 'init':
    case 'health':
    case 'all':
    case 'remote-node':
    case 'ingress':
    default:
      return undefined;
  }
}

/**
 * Adapt one raw policy item into the engine's PolicyRef. Handles both `spec`
 * (single group) and `specs[]` (Cilium multi-group) spellings; an item with
 * neither yields undefined.
 */
export function adaptPolicy(
  item: Record<string, unknown>,
  kind: PolicyRef['kind'],
  boardNamespace: string,
): PolicyRef | undefined {
  const meta = (item.metadata ?? {}) as { namespace?: string; name?: string };
  const isK8s = kind === 'NetworkPolicy';

  const specsRaw: Array<Record<string, unknown>> = isK8s
    ? [((item.spec ?? {}) as Record<string, unknown>)]
    : [...((item.specs ?? []) as Array<Record<string, unknown>>), ...((item.spec !== undefined ? [item.spec] : []) as Array<Record<string, unknown>>)];
  if (!isK8s && specsRaw.length === 0) return undefined;

  const specs: PolicyRef['specs'] = specsRaw.map(raw => {
    if (isK8s) {
      const spec = raw as unknown as RawK8sSpec;
      // K8s: a direction not in policyTypes is not enforced. With policyTypes
      // omitted (or empty), the apiserver DEFAULTS it before storing —
      // verified on this cluster (v1.35): [Ingress] always, plus [Egress] iff
      // the spec has egress rules. The adapter models that defaulting so a
      // stored bare-spec NP reads back as what the cluster actually
      // enforces, not as what the YAML happened to omit.
      const policyTypes = new Set(spec.policyTypes ?? []);
      const defaulted = policyTypes.size === 0;
      const enforcedIngress = policyTypes.has('Ingress') || defaulted;
      const enforcedEgress = policyTypes.has('Egress') || (defaulted && (spec.egress?.length ?? 0) > 0);

      const ingress: EngineEndpoint[] = [];
      for (const rule of spec.ingress ?? []) {
        const ports = portsSummary(rule.ports);
        const peers = rule.from ?? [];
        if (peers.length === 0) {
          // Ports-only rule: every pod in the policy's own namespace.
          ingress.push({ target: { kind: 'workload' }, ports });
          continue;
        }
        for (const peer of peers) {
          const ep = k8sPeerToEndpoint(peer, boardNamespace);
          if (ep) ingress.push({ ...ep, ports });
        }
      }
      const egress: EngineEndpoint[] = [];
      for (const rule of spec.egress ?? []) {
        const ports = portsSummary(rule.ports);
        const peers = rule.to ?? [];
        if (peers.length === 0) {
          egress.push({ target: { kind: 'workload' }, ports });
          continue;
        }
        for (const peer of peers) {
          const ep = k8sPeerToEndpoint(peer, boardNamespace);
          if (ep) egress.push({ ...ep, ports });
        }
      }
      return {
        endpointSelector: toEngineSelector(spec.podSelector),
        ingress,
        egress,
        enforcedIngress,
        enforcedEgress,
      };
    }

    // Cilium spec group.
    const spec = raw as RawCiliumSpec;
    // Cilium enforcement (real semantics): a direction is enforced for the
    // selected endpoints when the spec DEFINES it — rules in the direction
    // (allow or deny) — or when the spec has no rules at all (a bare
    // endpointSelector enables enforcement for BOTH directions). An absent
    // key with other rules present leaves that direction open. Note an empty
    // allow rule object (`ingress: [{}]`) is an allowAll wildcard — an ALLOW,
    // not a deny marker.
    const ingressRules = spec.ingress ?? [];
    const egressRules = spec.egress ?? [];
    const hasIngressDeny = (spec.ingressDeny?.length ?? 0) > 0;
    const hasEgressDeny = (spec.egressDeny?.length ?? 0) > 0;
    const bareSelectorEnforcesBoth = ingressRules.length === 0 && egressRules.length === 0;
    const enforcedIngress = ingressRules.length > 0 || hasIngressDeny || bareSelectorEnforcesBoth;
    const enforcedEgress = egressRules.length > 0 || hasEgressDeny || bareSelectorEnforcesBoth;

    const ingress: EngineEndpoint[] = [];
    for (const rule of ingressRules) {
      const ports = portsSummary(rule.toPorts);
      if (Object.keys(rule).length === 0) {
        // allowAll wildcard: traffic from anywhere — the board draws world,
        // host, kube-apiserver, and every local workload (no selector).
        for (const target of [
          { kind: 'world' } as const,
          { kind: 'host' } as const,
          { kind: 'kube-apiserver' } as const,
        ]) {
          ingress.push({ target, ports });
        }
        ingress.push({ target: { kind: 'workload' }, ports });
        continue;
      }
      for (const sel of rule.fromEndpoints ?? []) {
        const ep = ciliumEndpointToEndpoint(sel, boardNamespace);
        if (ep) ingress.push({ ...ep, ports });
      }
      for (const entity of rule.fromEntities ?? []) {
        const target = ciliumEntityToTarget(entity);
        if (target) ingress.push({ target, ports });
      }
      for (const cidr of rule.fromCIDR ?? []) {
        if (cidr) ingress.push({ target: { kind: 'cidr', cidr }, ports });
      }
      for (const set of rule.fromCIDRSet ?? []) {
        if (set.cidr) ingress.push({ target: { kind: 'cidr', cidr: set.cidr }, ports });
      }
    }
    const egress: EngineEndpoint[] = [];
    for (const rule of egressRules) {
      const ports = portsSummary(rule.toPorts);
      if (Object.keys(rule).length === 0) {
        for (const target of [
          { kind: 'world' } as const,
          { kind: 'host' } as const,
          { kind: 'kube-apiserver' } as const,
        ]) {
          egress.push({ target, ports });
        }
        egress.push({ target: { kind: 'workload' }, ports });
        continue;
      }
      for (const sel of rule.toEndpoints ?? []) {
        const ep = ciliumEndpointToEndpoint(sel, boardNamespace);
        if (ep) egress.push({ ...ep, ports });
      }
      for (const entity of rule.toEntities ?? []) {
        const target = ciliumEntityToTarget(entity);
        if (target) egress.push({ target, ports });
      }
      for (const cidr of rule.toCIDR ?? []) {
        if (cidr) egress.push({ target: { kind: 'cidr', cidr }, ports });
      }
      for (const set of rule.toCIDRSet ?? []) {
        if (set.cidr) egress.push({ target: { kind: 'cidr', cidr: set.cidr }, ports });
      }
      for (const fqdn of rule.toFQDNs ?? []) {
        // A FQDN name/pattern resolves to outside world on the board.
        if (fqdn.matchName || fqdn.matchPattern) egress.push({ target: { kind: 'world' }, ports });
      }
    }

    const endpointSelectorRaw = spec.endpointSelector;
    // CCNP endpoint selectors can carry namespaceSelector (a sibling key).
    const ccnpNsSel = endpointSelectorRaw
      ? toEngineSelector((endpointSelectorRaw as { namespaceSelector?: Record<string, unknown> }).namespaceSelector)
      : undefined;
    const hasCcnpNsScope =
      ccnpNsSel && (Object.keys(ccnpNsSel.matchLabels ?? {}).length > 0 || (ccnpNsSel.matchExpressions ?? []).length > 0);

    return {
      endpointSelector: ciliumPodLabels(endpointSelectorRaw),
      namespaceSelector: hasCcnpNsScope ? ccnpNsSel : undefined,
      ingress,
      egress,
      enforcedIngress,
      enforcedEgress,
    };
  });

  return {
    kind,
    namespace: kind === 'CiliumClusterwideNetworkPolicy' ? '' : meta.namespace ?? '',
    name: meta.name ?? '',
    specs: specs.filter(s => s !== undefined),
  };
}

/**
 * The namespace object's own labels, for CCNP namespaceSelector scoping.
 * Best-effort by design: an RBAC gap here only weakens CCNP scoping, it must
 * not blank the board.
 */
export async function fetchNamespaceLabels(namespace: string): Promise<Record<string, string>> {
  const res = await request(`api/v1/namespaces/${namespace}`).catch(() => undefined);
  if (!res) return {};
  const body = (await res.json()) as { metadata?: { labels?: Record<string, string> } };
  return body.metadata?.labels ?? {};
}

/**
 * Everything the board needs for one namespace, in one shot: pods, workloads,
 * the namespace's own NPs/CNPs, and every CCNP — with pods attributed to
 * workloads by selector match.
 */
/** All namespace names in the cluster (board inventory, best-effort). */
export async function listAllNamespaces(): Promise<string[]> {
  return request('api/v1/namespaces')
    .then(r => r.json())
    .then((o: { items?: Array<{ metadata?: { name?: string } }> }) =>
      (o.items ?? []).map(i => i.metadata?.name ?? '').filter(Boolean))
    .catch(() => [] as string[]);
}


export async function fetchTopologyData(namespace: string): Promise<{
  pods: PodInfo[];
  policies: PolicyRef[];
  workloads: WorkloadInfo[];
}> {
  const [pods, workloads, np, cnp, ccnp] = await Promise.all([
    listPods(namespace),
    listWorkloads(namespace),
    request(`apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies`)
      .then(r => r.json())
      .catch(() => ({ items: [] })),
    request(`apis/cilium.io/v2/namespaces/${namespace}/ciliumnetworkpolicies`)
      .then(r => r.json())
      .catch(() => ({ items: [] })),
    request(`apis/cilium.io/v2/ciliumclusterwidenetworkpolicies`)
      .then(r => r.json())
      .catch(() => ({ items: [] })),
  ]);

  const policies: PolicyRef[] = [];
  const push = (item: Record<string, unknown>, kind: PolicyRef['kind']): void => {
    const ref = adaptPolicy(item, kind, namespace);
    if (ref) policies.push(ref);
  };
  for (const item of (((np as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>)) {
    push(item, 'NetworkPolicy');
  }
  for (const item of (((cnp as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>)) {
    push(item, 'CiliumNetworkPolicy');
  }
  for (const item of (((ccnp as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>)) {
    push(item, 'CiliumClusterwideNetworkPolicy');
  }

  // Attribute pods to workloads: the workload whose selector matches the
  // pod's labels. First match wins — selectors are disjoint in sane clusters.
  const attributed = pods.map(pod => {
    const workload = workloads.find(w =>
      // Match on matchLabels subset AND matchExpressions against pod labels.
      selectorMatches(w.selector, pod.labels),
    )?.name;
    return { ...pod, workload };
  });

  return { pods: attributed, policies, workloads };
}
