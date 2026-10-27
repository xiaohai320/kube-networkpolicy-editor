import yaml from 'js-yaml';
import { en, type Msg } from '@/i18n';
import type {
  Direction,
  Endpoint,
  LabelSelector,
  MatchExpression,
  Policy,
  PolicyFormat,
  PolicySpec,
  PortRule,
  Protocol,
  RuleGroup,
  UnsupportedRules,
} from '@/types/policy';
import { generateId } from './utils';
import {
  ALL_NAMESPACES,
  NAMESPACE_LABEL,
  NAMESPACE_NAME_LABEL,
  findAllNamespacesExpression,
  fromCiliumExpressionKey,
  fromCiliumPodLabels,
  isEmptySelector,
  splitCiliumLabels,
} from './label-utils';

/**
 * Error thrown for malformed or unsupported input. `key` is what the UI
 * renders; `message` is deliberately English so stack traces and console
 * output are greppable in a single language regardless of the locale.
 */
export class PolicyParseError extends Error {
  readonly key: string;
  readonly params?: Msg['params'];

  constructor(msg: Msg, public readonly line?: number) {
    super(en[msg.key as keyof typeof en] ?? msg.key);
    this.name = 'PolicyParseError';
    this.key = msg.key;
    this.params = msg.params;
  }
}

/** Runtime narrowing helpers — YAML parses to `unknown` everywhere. */
function asObject(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function asRecordArray(v: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object');
}

/* ------------------------------------------------------------------ */
/* Shared label helpers                                                */
/* ------------------------------------------------------------------ */

interface ExprInput {
  key?: string;
  operator?: string;
  values?: unknown[];
}

const OPERATORS = new Set<string>(['In', 'NotIn', 'Exists', 'DoesNotExist']);

function parseExpressions(input?: ExprInput[]): MatchExpression[] | undefined {
  if (!input || input.length === 0) return undefined;
  const out: MatchExpression[] = [];
  for (const raw of input) {
    const key = raw.key;
    if (!key) continue;
    const operator = (raw.operator ?? 'In') as MatchExpression['operator'];
    if (!OPERATORS.has(operator)) continue;
    out.push({
      key,
      operator,
      values: (raw.values ?? []).filter((v): v is string => typeof v === 'string'),
    });
  }
  return out.length > 0 ? out : undefined;
}

function parseSelector(sel: Record<string, unknown> | null | undefined): LabelSelector {
  if (!sel || typeof sel !== 'object') return {};
  const matchLabels = (sel.matchLabels ?? {}) as Record<string, unknown>;
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(matchLabels)) {
    if (v !== null && v !== undefined) labels[k] = String(v);
  }
  return {
    matchLabels: Object.keys(labels).length > 0 ? labels : undefined,
    matchExpressions: parseExpressions(sel.matchExpressions as ExprInput[] | undefined),
  };
}

function parsePorts(input?: Array<Record<string, unknown>>): PortRule[] {
  if (!input) return [];
  const out: PortRule[] = [];
  for (const p of input) {
    if (p.port === undefined || p.port === null) continue;
    // Numeric ports are written as strings, so coerce them back rather than
    // leaving a `"80"` next to an authored `80`.
    const raw = typeof p.port === 'number' ? p.port : String(p.port);
    const port = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    const protocol = (p.protocol ?? 'TCP') as Protocol;
    out.push({ port, protocol });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Kubernetes NetworkPolicy                                            */
/* ------------------------------------------------------------------ */

interface K8sPeerInput {
  ipBlock?: { cidr?: string; except?: unknown[] };
  namespaceSelector?: Record<string, unknown>;
  podSelector?: Record<string, unknown>;
}

/**
 * Which group a Kubernetes peer lands in depends on which selectors it carried.
 * A `namespaceSelector` means cross-namespace; a bare `podSelector` means pods
 * in this policy's namespace — which is how the CRD scopes namespace-local
 * peers, since `podSelector` alone never leaves the policy's namespace.
 */
function parseK8sPeer(peer: K8sPeerInput): Endpoint | null {
  if (peer.ipBlock) {
    const cidr = peer.ipBlock.cidr;
    if (!cidr) return null;
    const except = (peer.ipBlock.except ?? []).filter(
      (v): v is string => typeof v === 'string',
    );
    return makeEndpoint('cidr', 'outside', { cidr, except });
  }

  if (peer.namespaceSelector) {
    const nsSel = parseSelector(peer.namespaceSelector);
    const podSel = parseSelector(peer.podSelector);

    // `namespaceSelector: {}` on its own selects every pod in the cluster.
    if (isEmptySelector(nsSel) && isEmptySelector(podSel)) {
      return makeEndpoint('all', 'cluster', {});
    }

    const nsLabels = { ...(nsSel.matchLabels ?? {}) };
    const namespace = nsLabels[NAMESPACE_NAME_LABEL];
    delete nsLabels[NAMESPACE_NAME_LABEL];

    return makeEndpoint('labels', 'cluster', {
      namespace: namespace ?? (isEmptySelector(nsSel) ? ALL_NAMESPACES : undefined),
      namespaceSelector: Object.keys(nsLabels).length > 0 ? nsLabels : undefined,
      namespaceExpressions: nsSel.matchExpressions,
      podSelector: podSel.matchLabels,
      podExpressions: podSel.matchExpressions,
    });
  }

  const podSel = parseSelector(peer.podSelector);
  // An empty or absent podSelector still means "every pod in this namespace".
  if (isEmptySelector(podSel)) return makeEndpoint('all', 'namespace', {});

  // A bare `podSelector` never leaves the policy's own namespace.
  return makeEndpoint('labels', 'namespace', {
    podSelector: podSel.matchLabels,
    podExpressions: podSel.matchExpressions,
  });
}

function makeEndpoint(
  kind: Endpoint['kind'],
  group: RuleGroup,
  extra: Record<string, unknown>,
): Endpoint {
  return {
    id: generateId(),
    group,
    ports: [],
    kind,
    ...extra,
  } as Endpoint;
}

interface K8sDocInput {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: Record<string, unknown>;
}

function parseK8sPolicy(doc: K8sDocInput): PolicySpec {
  const spec = doc.spec ?? {};
  const policyTypes = new Set((spec.policyTypes as string[] | undefined) ?? []);

  const parseRules = (direction: Direction, ruleKey: 'from' | 'to'): Endpoint[] => {
    const raw = spec[direction] as Array<Record<string, unknown>> | undefined;
    if (!raw) return [];
    const out: Endpoint[] = [];
    for (const rule of raw) {
      const ports = parsePorts(rule.ports as Array<Record<string, unknown>> | undefined);
      const peers = (rule[ruleKey] as K8sPeerInput[] | undefined) ?? [];
      if (peers.length === 0) {
        // A rule with NO `from` and NO ports is the allow-all spelling the
        // generator pins (verified live: stored verbatim, allows every
        // source). With ports but no peer, sources stay confined to the
        // policy's own namespace — a `from` is what widens the rule.
        if (ports.length === 0) {
          out.push(makeEndpoint('all', 'outside', {}));
        } else {
          out.push(makeEndpoint('all', 'namespace', { ports }));
        }
        continue;
      }
      for (const peer of peers) {
        const endpoint = parseK8sPeer(peer);
        if (endpoint) {
          endpoint.ports = ports;
          out.push(endpoint);
        }
      }
    }
    return out;
  };

  const ingress = parseRules('ingress', 'from');
  const egress = parseRules('egress', 'to');

  // `policyTypes` makes deny-by-default intrinsic, so a direction carrying
  // rules is already restricted. Only a ruleless direction with its policyType
  // is an explicit "deny everything".
  //
  // An omitted (or empty) policyTypes is DEFAULTED by the apiserver before
  // storage — [Ingress] always, plus [Egress] iff egress rules exist — so a
  // stored bare-spec NP denies all ingress on the cluster regardless of what
  // its YAML omits. The parser models that defaulting so an imported policy
  // shows the state the cluster actually enforces.
  const defaulted = policyTypes.size === 0;
  return {
    id: generateId(),
    endpointSelector: parseSelector(asObject(spec.podSelector) ?? asObject(spec.endpointSelector)),
    ingress,
    egress,
    defaultDenyIngress: (policyTypes.has('Ingress') || defaulted) && ingress.length === 0,
    defaultDenyEgress: (policyTypes.has('Egress') || (defaulted && egress.length > 0)) && egress.length === 0,
  };
}

export function parseK8sYaml(yamlString: string): Policy {
  return parseK8sPolicyStream(yamlString);
}

/* ------------------------------------------------------------------ */
/* Cilium CiliumNetworkPolicy                                          */
/* ------------------------------------------------------------------ */

interface CiliumPortGroupInput {
  ports?: Array<Record<string, unknown>>;
  rules?: Record<string, unknown>;
}

/**
 * A toPorts group carrying ANY `rules` block (L7: http, dns, kafka, tls…)
 * makes the whole rule unrepresentable: it is routed to `unsupported`
 * verbatim rather than parsed, so nothing is silently dropped.
 */
function hasUnmodelableL7Rules(groups?: CiliumPortGroupInput[]): boolean {
  return (groups ?? []).some(
    g => g.rules !== undefined && Object.keys(g.rules).length > 0,
  );
}

const SERVICE_ENTITY_PREFIX = 'k8s:service:';

/**
 * Entity names we model, mapped to the (group, kind) they become. Anything
 * not listed here is routed to `unsupported` so nothing is silently dropped.
 */
const ENTITY_MAP: Record<
  string,
  { group: RuleGroup; kind: 'all' | 'entity' | 'kube-dns'; entity?: 'host' | 'remote-node' }
> = {
  world: { group: 'outside', kind: 'all' },
  cluster: { group: 'cluster', kind: 'all' },
  // Cilium's `all` matches every cluster endpoint, which is what `cluster` does.
  all: { group: 'cluster', kind: 'all' },
  host: { group: 'cluster', kind: 'entity', entity: 'host' },
  'remote-node': { group: 'cluster', kind: 'entity', entity: 'remote-node' },
  'kube-dns': { group: 'cluster', kind: 'kube-dns' },
};

function parseCiliumEntities(
  entities: string[],
  ports: PortRule[],
  out: Endpoint[],
  unsupported: unknown[],
): void {
  for (const raw of entities) {
    if (typeof raw !== 'string') continue;

    // Cilium also allows service entities such as `k8s:service:kube-system/dns`.
    if (raw.startsWith(SERVICE_ENTITY_PREFIX)) {
      const [namespace, serviceName] = raw.slice(SERVICE_ENTITY_PREFIX.length).split('/');
      if (namespace && serviceName) {
        out.push(makeEndpoint('service', 'namespace', { namespace, serviceName, ports }));
      } else {
        unsupported.push({ entities: [raw], ports });
      }
      continue;
    }

    const { group, kind, entity } = ENTITY_MAP[raw] ?? {};
    if (!group || !kind) {
      unsupported.push({ entities: [raw], ports });
      continue;
    }
    out.push(
      makeEndpoint(kind, group, {
        ...(entity ? { entity } : {}),
        ports,
      }),
    );
  }
}

function parseCiliumLabels(
  selectors: Array<Record<string, unknown>>,
  ports: PortRule[],
  out: Endpoint[],
  policyNamespace: string,
): void {
  for (const sel of selectors) {
    const rawLabels = (sel.matchLabels ?? {}) as Record<string, unknown>;
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawLabels)) {
      if (v !== null && v !== undefined && !isCiliumInternal(k)) labels[k] = String(v);
    }
    const rawExpressions = parseExpressions(sel.matchExpressions as ExprInput[] | undefined) ?? [];
    const expressions = rawExpressions.filter(e => !isCiliumInternal(e.key));

    const { namespace, podSelector, namespaceSelector } = splitCiliumLabels(labels);
    const allNamespaces = findAllNamespacesExpression(expressions);

    if (isEmptySelector({ matchLabels: labels, matchExpressions: expressions })) {
      // `fromEndpoints: [{}]` selects every endpoint in every namespace, so it
      // is cluster-wide rather than namespace-local.
      out.push(makeEndpoint('all', 'cluster', { ports }));
      continue;
    }

    // The all-namespaces marker is already captured by `namespace: '*'`, so it
    // is not repeated as an expression.
    const nsExpressions = expressions.filter(
      e => e.key.startsWith(NAMESPACE_LABEL) && !findAllNamespacesExpression([e]),
    );
    const podExpressions = expressions
      .filter(e => !e.key.startsWith(NAMESPACE_LABEL))
      .map(e => ({ ...e, key: fromCiliumExpressionKey(e.key) }));

    // The generator names the policy's own namespace to make a rule
    // namespace-local, so a namespace of the policy's own reads back with none.
    const ownNamespace = namespace === policyNamespace;
    const resolvedNamespace = ownNamespace
      ? undefined
      : (namespace ?? (allNamespaces ? ALL_NAMESPACES : undefined));

    // A namespace in scope means this peer is cross-namespace, which is the
    // `cluster` group; without one it is confined to the policy's namespace.
    const hasNsScope =
      resolvedNamespace !== undefined ||
      Object.keys(namespaceSelector).length > 0 ||
      nsExpressions.length > 0;

    out.push(
      makeEndpoint(
        hasNsScope || Object.keys(podSelector).length > 0 || podExpressions.length > 0
          ? 'labels'
          : 'all',
        hasNsScope ? 'cluster' : 'namespace',
        {
          podSelector: Object.keys(podSelector).length > 0 ? podSelector : undefined,
          podExpressions: podExpressions.length > 0 ? podExpressions : undefined,
          namespace: resolvedNamespace,
          namespaceSelector:
            Object.keys(namespaceSelector).length > 0 ? namespaceSelector : undefined,
          namespaceExpressions:
            nsExpressions.length > 0 ? nsExpressions : undefined,
          ports,
        },
      ),
    );
  }
}

function parseCiliumCidrs(
  plain: string[] | undefined,
  sets: Array<Record<string, unknown>> | undefined,
  ports: PortRule[],
  out: Endpoint[],
): void {
  for (const cidr of plain ?? []) {
    if (typeof cidr !== 'string' || !cidr) continue;
    out.push(makeEndpoint('cidr', 'outside', { cidr, ports }));
  }
  for (const set of sets ?? []) {
    const cidr = typeof set.cidr === 'string' ? set.cidr : undefined;
    if (!cidr) continue;
    const except = asStringArray(set.except);
    out.push(
      makeEndpoint('cidr', 'outside', {
        cidr,
        ...(except && except.length > 0 ? { except } : {}),
        ports,
      }),
    );
  }
}

function parseCiliumFqdns(
  fqdns: Array<Record<string, unknown>> | undefined,
  ports: PortRule[],
  out: Endpoint[],
): void {
  for (const f of fqdns ?? []) {
    const matchName = typeof f.matchName === 'string' ? f.matchName : undefined;
    const matchPattern = typeof f.matchPattern === 'string' ? f.matchPattern : undefined;
    if (!matchName && !matchPattern) continue;
    out.push(makeEndpoint('fqdn', 'outside', { matchName, matchPattern, ports }));
  }
}

function parseCiliumServices(
  services: Array<Record<string, unknown>>,
  ports: PortRule[],
  out: Endpoint[],
  unsupported: unknown[],
): void {
  for (const svc of services) {
    const k8s = svc.k8sService as { namespace?: string; serviceName?: string } | undefined;
    const sel = svc.k8sServiceSelector as {
      namespace?: string;
      selector?: Record<string, unknown>;
    } | undefined;
    if (k8s?.serviceName) {
      out.push(
        makeEndpoint('service', 'namespace', {
          namespace: k8s.namespace,
          serviceName: k8s.serviceName,
          ports,
        }),
      );
      continue;
    }
    if (sel?.selector) {
      out.push(
        makeEndpoint('service', 'namespace', {
          namespace: sel.namespace,
          selector: parseSelector(sel.selector).matchLabels,
          ports,
        }),
      );
      continue;
    }
    unsupported.push(svc);
  }
}

const INGRESS_KEYS = new Set([
  'fromEndpoints', 'fromEntities', 'fromCIDR', 'fromCIDRSet', 'fromServices', 'toPorts',
]);
const EGRESS_KEYS = new Set([
  'toEndpoints', 'toEntities', 'toCIDR', 'toCIDRSet', 'toServices', 'toFQDNs', 'toPorts',
]);

/** Labels Cilium injects itself; they never select Kubernetes labels. */
const CILIUM_INTERNAL_PREFIXES = ['io.cilium.', 'reserved:', 'io.cilium.k8s.'];

function isCiliumInternal(key: string): boolean {
  return CILIUM_INTERNAL_PREFIXES.some(p => key.startsWith(p));
}

/**
 * The policy-level endpoint selector uses the same `k8s:` prefixing as peers,
 * so it gets the same normalization rather than storing raw Cilium labels.
 */
function parseCiliumEndpointSelector(
  sel: Record<string, unknown> | null | undefined,
): LabelSelector {
  const parsed = parseSelector(sel);
  const podLabels = fromCiliumPodLabels(parsed.matchLabels);
  const expressions = (parsed.matchExpressions ?? []).map(e => ({
    ...e,
    key: fromCiliumExpressionKey(e.key),
  }));
  return {
    matchLabels: Object.keys(podLabels).length > 0 ? podLabels : undefined,
    matchExpressions: expressions.length > 0 ? expressions : undefined,
  };
}

/** A spec still carrying its own unsupported rules, before they are hoisted. */
type ParsedSpec = PolicySpec & { unsupported?: UnsupportedRules };

/**
 * The policy's own namespace lets a namespace-local rule be recognised again:
 * Cilium has no namespace scoping to infer it from, so the generator writes the
 * namespace out explicitly.
 */
function parseCiliumSpec(spec: Record<string, unknown>, policyNamespace: string): ParsedSpec {
  const unsupported: UnsupportedRules = { ingress: [], egress: [] };

  const parseRules = (
    direction: Direction,
    validKeys: Set<string>,
    bucket: unknown[],
  ): { endpoints: Endpoint[]; wildcard: boolean } => {
    const raw = asRecordArray(spec[direction]);
    if (!raw) return { endpoints: [], wildcard: false };
    const out: Endpoint[] = [];
    let wildcardSeen = false;

    for (const rule of raw) {
      const ownKeys = Object.keys(rule);
      if (ownKeys.length === 0) {
        // An empty rule object is Cilium's allowAll wildcard: it matches every
        // source and destination — not just the cluster, EVERYTHING. A
        // direction whose ONLY rules are wildcards is therefore plain
        // allow-all (the badge state, no canvas rules — handled below); among
        // concrete rules it acts as a catch-all, imported as an explicit "all"
        // peer. (The deny-all direction is the KEY being absent — enforcement
        // without rules — or an empty object in the ingressDeny list.)
        wildcardSeen = true;
        continue;
      }
      if (!ownKeys.every(k => validKeys.has(k))) {
        bucket.push(rule);
        continue;
      }
      if (hasUnmodelableL7Rules(asRecordArray(rule.toPorts) as CiliumPortGroupInput[] | undefined)) {
        bucket.push(rule);
        continue;
      }

      const ports = flattenPorts(asRecordArray(rule.toPorts) as CiliumPortGroupInput[] | undefined);
      const prefix = direction === 'ingress' ? 'from' : 'to';
      const before = out.length;

      parseCiliumEntities(asStringArray(rule[`${prefix}Entities`]) ?? [], ports, out, bucket);
      parseCiliumCidrs(
        asStringArray(rule[`${prefix}CIDR`]),
        asRecordArray(rule[`${prefix}CIDRSet`]),
        ports,
        out,
      );
      parseCiliumLabels(
        asRecordArray(rule[`${prefix}Endpoints`]) ?? [],
        ports,
        out,
        policyNamespace,
      );
      parseCiliumServices(
        asRecordArray(rule[`${prefix}Services`]) ?? [],
        ports,
        out,
        bucket,
      );
      if (direction === 'egress') {
        parseCiliumFqdns(asRecordArray(rule.toFQDNs), ports, out);
      }

      // Ports only, no peer: in Cilium a rule with no endpoint selector
      // matches every endpoint in the cluster.
      if (out.length === before && ports.length > 0) {
        out.push(makeEndpoint('all', 'cluster', { ports }));
      }
    }

    if (!wildcardSeen) return { endpoints: out, wildcard: false };
    if (out.length === 0) {
      // Only wildcards: the direction is plainly allow-all — badge state,
      // no rules. The wildcard flag keeps the direction DEFINED (enforced),
      // so a bare-selector deny does not wrongly swallow it.
      return { endpoints: [], wildcard: true };
    }
    // Wildcard as catch-all among concrete rules: an explicit "all" peer.
    // Cilium's wildcard spans world too, but the canvas has no single shape
    // for "everything"; cluster + world peers together approximate it.
    out.push(makeEndpoint('all', 'cluster', {}));
    out.push(makeEndpoint('all', 'outside', {}));
    return { endpoints: out, wildcard: true };
  };

  const ingressParsed = parseRules('ingress', INGRESS_KEYS, unsupported.ingress);
  const egressParsed = parseRules('egress', EGRESS_KEYS, unsupported.egress);
  const ingress = ingressParsed.endpoints;
  const egress = egressParsed.endpoints;

  // Deny sections: an empty deny rule object denies EVERYTHING in the
  // direction (the modelable "deny all"); anything else there is a selective
  // deny rule the canvas has no shape for — preserved verbatim instead.
  const parseDenyRules = (key: 'ingressDeny' | 'egressDeny', bucket: unknown[]): boolean => {
    const raw = asRecordArray(spec[key]);
    if (!raw) return false;
    let denyAll = false;
    for (const rule of raw) {
      if (Object.keys(rule).length === 0) denyAll = true;
      else bucket.push(rule);
    }
    return denyAll;
  };
  const denyAllIngress = parseDenyRules('ingressDeny', unsupported.ingressDeny ??= []);
  const denyAllEgress = parseDenyRules('egressDeny', unsupported.egressDeny ??= []);

  // Enforcement (real Cilium semantics): selecting endpoints puts them under
  // policy for the directions the spec DEFINES. A direction is defined when it
  // has rules (allow or deny); a spec with NO rules at all — a bare
  // endpointSelector — enables enforcement for BOTH directions. A defined
  // direction with no allow rules is default-deny; a direction the spec does
  // not define stays open (allow-all) unless another policy enforces it.
  // (An empty allow list is indistinguishable from an absent key: nil ==
  // [] after JSON unmarshal.)
  const bareSelectorEnforcesBoth = ingress.length === 0 && egress.length === 0 &&
    unsupported.ingress.length === 0 && unsupported.egress.length === 0 &&
    (unsupported.ingressDeny?.length ?? 0) === 0 && (unsupported.egressDeny?.length ?? 0) === 0 &&
    !denyAllIngress && !denyAllEgress && // an explicit deny rule defines that direction
    !ingressParsed.wildcard && !egressParsed.wildcard; // so does an allowAll wildcard
  const defaultDenyIngress = (ingress.length === 0 && unsupported.ingress.length === 0) &&
    (bareSelectorEnforcesBoth || denyAllIngress || (unsupported.ingressDeny?.length ?? 0) > 0);
  const defaultDenyEgress = (egress.length === 0 && unsupported.egress.length === 0) &&
    (bareSelectorEnforcesBoth || denyAllEgress || (unsupported.egressDeny?.length ?? 0) > 0);

  const parsed: ParsedSpec = {
    id: generateId(),
    endpointSelector: parseCiliumEndpointSelector(asObject(spec.endpointSelector)),
    ingress,
    egress,
    defaultDenyIngress,
    defaultDenyEgress,
  };

  if (unsupported.ingress.length + unsupported.egress.length +
      (unsupported.ingressDeny?.length ?? 0) + (unsupported.egressDeny?.length ?? 0) > 0) {
    parsed.unsupported = unsupported;
  }
  return parsed;
}

function flattenPorts(groups?: CiliumPortGroupInput[]): PortRule[] {
  const out: PortRule[] = [];
  for (const g of groups ?? []) {
    // Groups carrying an L7 `rules` block were already routed to unsupported
    // by hasUnmodelableL7Rules; only filterless groups reach here.
    out.push(...parsePorts(g.ports));
  }
  return out;
}

export function parseCiliumYaml(yamlString: string): Policy {
  const doc = loadAllDocs(yamlString)[0] ?? {};
  const meta = asObject(doc.metadata) ?? {};
  const namespace = (meta.namespace as string | undefined) ?? 'default';

  // A CiliumNetworkPolicy carries its selectors as `specs[]`; `spec` is a
  // shorthand for a single group. `specs[]` entries are the spec objects
  // directly — there is no wrapping `spec` key.
  const specObjs = asRecordArray(doc.specs) ?? [asObject(doc.spec) ?? {}];
  const parsed = specObjs.map(spec => parseCiliumSpec(spec, namespace));

  const unsupported: UnsupportedRules = { ingress: [], egress: [] };
  for (const p of parsed) {
    const u = p.unsupported;
    if (!u) continue;
    unsupported.ingress.push(...u.ingress);
    unsupported.egress.push(...u.egress);
    unsupported.ingressDeny = [...(unsupported.ingressDeny ?? []), ...(u.ingressDeny ?? [])];
    unsupported.egressDeny = [...(unsupported.egressDeny ?? []), ...(u.egressDeny ?? [])];
    delete p.unsupported;
  }

  const policy: Policy = {
    id: generateId(),
    name: (meta.name as string | undefined) ?? 'imported-policy',
    namespace,
    format: 'cilium',
    specs: parsed,
  };
  if (unsupported.ingress.length + unsupported.egress.length +
      (unsupported.ingressDeny?.length ?? 0) + (unsupported.egressDeny?.length ?? 0) > 0) {
    policy.unsupported = unsupported;
  }
  return policy;
}

/* ------------------------------------------------------------------ */
/* Format detection                                                    */
/* ------------------------------------------------------------------ */

function loadAllDocs(yamlString: string): Array<Record<string, unknown>> {
  let docs: unknown[];
  try {
    docs = yaml.loadAll(yamlString);
  } catch (err) {
    throw new PolicyParseError(
      err instanceof Error ? { key: 'error-invalid-yaml', params: { message: err.message } } : { key: 'error-invalid-yaml' },
    );
  }
  return docs.filter((d): d is Record<string, unknown> => d !== null && typeof d === 'object');
}

function detectFormat(doc: Record<string, unknown>): PolicyFormat | null {
  switch (doc.kind) {
    // CCNPs share the CNP schema — the same parser handles both. (CCNPs are
    // cluster-scoped, so their namespace is usually absent and defaults.)
    case 'CiliumNetworkPolicy':
    case 'CiliumClusterwideNetworkPolicy':
      return 'cilium';
    case 'NetworkPolicy':
      return 'k8s';
    default:
      return null;
  }
}

/**
 * Parse YAML into a policy, auto-detecting the format from `kind`.
 * A multi-document stream of the same kind becomes one policy with several
 * selector groups.
 */
export function detectAndParse(
  yamlString: string,
): { policy: Policy; format: PolicyFormat; specs: number } {
  const docs = loadAllDocs(yamlString);
  if (docs.length === 0) throw new PolicyParseError({ key: 'error-no-policy' });

  const formats = new Set(docs.map(d => detectFormat(d)).filter((f): f is PolicyFormat => f !== null));
  if (formats.size === 0) {
    const kind = docs[0]?.kind;
    throw new PolicyParseError(
      kind
        ? { key: 'error-unsupported-kind', params: { kind: String(kind) } }
        : { key: 'error-no-supported-kind' },
    );
  }
  if (formats.size > 1) {
    throw new PolicyParseError({
      key: 'error-mixed-kinds',
      params: { kinds: Array.from(formats).join(', ') },
    });
  }

  const format = formats.values().next().value as PolicyFormat;
  const policy = format === 'cilium' ? parseCiliumYaml(yamlString) : parseK8sPolicyStream(yamlString);
  return { policy, format, specs: policy.specs.length };
}

function parseK8sPolicyStream(yamlString: string): Policy {
  const docs = loadAllDocs(yamlString);
  const specs = docs.map(d => parseK8sPolicy(d as K8sDocInput));
  const meta = asObject(docs[0]?.metadata) ?? {};
  return {
    id: generateId(),
    name: (meta.name as string | undefined) ?? 'imported-policy',
    namespace: (meta.namespace as string | undefined) ?? 'default',
    format: 'k8s',
    specs,
  };
}

