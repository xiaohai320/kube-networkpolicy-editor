import { generateId } from '@/lib/utils';

/** Traffic direction of a rule list. */
export type Direction = 'ingress' | 'egress';

/**
 * Which column a rule belongs to — the three groups in the canvas.
 * Mirrors the live editor's rule-group kinds:
 *
 * - `outside`   → outside the cluster (CNP `world`, K8s `ipBlock`)
 * - `namespace` → pods in this policy's own namespace: no namespace to choose
 * - `cluster`   → anywhere in this cluster, so a namespace can be picked
 *
 * The group also decides what `kind: 'all'` means, which is why a peer carries
 * both `group` and `kind` rather than collapsing into one field.
 */
export type RuleGroup = 'outside' | 'namespace' | 'cluster';

export type Protocol = 'TCP' | 'UDP' | 'SCTP';

/** A Cilium port can be numeric, a named port, or a range such as `5000:5100`. */
export interface PortRule {
  port: number | string;
  protocol: Protocol;
}

export type LabelOperator = 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';

export interface MatchExpression {
  key: string;
  operator: LabelOperator;
  values: string[];
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: MatchExpression[];
}

/**
 * Cilium built-in entities we can author. `all`, `world` and `cluster` are not
 * listed here: they are already expressed by the `RuleGroup`, so the only
 * entities that add information are these two.
 */
export type CiliumEntity = 'host' | 'remote-node';

interface EndpointBase {
  /** Stable id — never serialized into YAML. */
  id: string;
  /** Which column renders this peer, and what `kind: 'all'` resolves to. */
  group: RuleGroup;
  /** Empty means "all ports". */
  ports: PortRule[];
}

/**
 * A concrete peer a policy rule talks to. Exactly one variant applies.
 *
 * Discriminated on `kind` so generators and parsers can switch exhaustively.
 * This replaces the previous flat bag of optional fields (`cidr?`, `fqdn?`,
 * `entity?`, `podSelector?`, `namespaceSelector?`), where nothing enforced
 * mutual exclusivity and every generator branch had to guess which one applied.
 */
export type Endpoint =
  /** Everything in this group. */
  | (EndpointBase & { kind: 'all' })
  /** A CIDR block, optionally with exclusions. */
  | (EndpointBase & { kind: 'cidr'; cidr: string; except?: string[] })
  /** A hostname pattern. Egress only, Cilium only. */
  | (EndpointBase & { kind: 'fqdn'; matchName?: string; matchPattern?: string })
  /** A Cilium built-in entity. Cilium only. */
  | (EndpointBase & { kind: 'entity'; entity: CiliumEntity })
  /** The cluster's kube-dns endpoints. */
  | (EndpointBase & { kind: 'kube-dns' })
  /**
   * Pods selected by labels. In the `namespace` group the peer stays inside
   * this policy's own namespace, so only the pod labels apply; the namespace
   * fields are for the `cluster` group, where the peer may reach any namespace.
   */
  | (EndpointBase & {
      kind: 'labels';
      /** Pod labels. */
      podSelector?: Record<string, string>;
      podExpressions?: MatchExpression[];
      /** Exact namespace name. `'*'` means every namespace. */
      namespace?: string;
      /** Namespace label selectors. */
      namespaceSelector?: Record<string, string>;
      namespaceExpressions?: MatchExpression[];
    })
  /** A Kubernetes service. Cilium only; authoring deferred. */
  | (EndpointBase & {
      kind: 'service';
      namespace?: string;
      serviceName?: string;
      selector?: Record<string, string>;
    });

export type EndpointKind = Endpoint['kind'];

/**
 * One selector group. CiliumNetworkPolicy allows several via `specs[]`; a policy
 * with a single group serializes as `spec`.
 */
export interface PolicySpec {
  id: string;
  /** The pods this group applies to. Empty = all pods in the namespace. */
  endpointSelector: LabelSelector;
  ingress: Endpoint[];
  egress: Endpoint[];
  /**
   * Explicit default-deny. Having at least one rule also implies deny, so these
   * flags exist only to express "deny everything, allow nothing".
   */
  defaultDenyIngress: boolean;
  defaultDenyEgress: boolean;
}

export type PolicyFormat = 'k8s' | 'cilium';

/** Rules the editor cannot represent, kept so an import is not lossy.
    Deny-section rules ride in their own buckets: re-emitting them into the
    allow lists would turn "deny this CIDR" into "allow this CIDR". */
export interface UnsupportedRules {
  ingress: unknown[];
  egress: unknown[];
  ingressDeny?: unknown[];
  egressDeny?: unknown[];
}

export interface Policy {
  id: string;
  name: string;
  namespace: string;
  /** Which tab the YAML was last produced from / imported as. */
  format: PolicyFormat;
  specs: PolicySpec[];
  unsupported?: UnsupportedRules;
}

export function createDefaultPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: generateId(),
    name: 'my-network-policy',
    namespace: 'default',
    format: 'k8s',
    specs: [createDefaultSpec()],
    ...overrides,
  };
}

export function createDefaultSpec(overrides: Partial<PolicySpec> = {}): PolicySpec {
  return {
    id: generateId(),
    endpointSelector: {},
    ingress: [],
    egress: [],
    defaultDenyIngress: false,
    defaultDenyEgress: false,
    ...overrides,
  };
}

/** Default field values for a freshly authored endpoint of each kind. */
const ENDPOINT_DEFAULTS: Record<EndpointKind, Record<string, unknown>> = {
  all: {},
  cidr: { cidr: '' },
  fqdn: { matchPattern: '' },
  entity: { entity: 'host' },
  'kube-dns': {},
  labels: {},
  service: {},
};

/**
 * Build a new endpoint. The trailing cast is deliberate: the defaults table is
 * a plain record so this stays one small function, and every other use of
 * `Endpoint` is discriminated on `kind`, so a malformed construction fails
 * loudly at the first exhaustive switch instead of quietly.
 */
export function newEndpoint(
  kind: EndpointKind,
  group: RuleGroup,
  extra: Record<string, unknown> = {},
): Endpoint {
  return {
    id: generateId(),
    group,
    ports: [],
    kind,
    ...ENDPOINT_DEFAULTS[kind],
    ...extra,
  } as Endpoint;
}

/**
 * Clone a picker template endpoint with a fresh id. Picker options are module
 * constants, so sharing them by reference across two additions would make both
 * new rules alias the same id.
 */
export function cloneEndpoint(endpoint: Endpoint): Endpoint {
  return {
    ...endpoint,
    id: generateId(),
    ports: endpoint.ports.map(p => ({ ...p })),
  } as Endpoint;
}

/**
 * Partially update an endpoint. `Partial<Endpoint>` over a discriminated union
 * widens `kind` to the union of every variant, so the cast and the explicit
 * `kind` restore it — callers only ever send fields for the variant they render.
 */
export function mergeEndpoint(endpoint: Endpoint, changes: Partial<Endpoint>): Endpoint {
  return { ...endpoint, ...changes, kind: endpoint.kind } as Endpoint;
}

/** True for peers the Kubernetes NetworkPolicy CRD cannot express. */
export function isK8sUnrepresentable(endpoint: Endpoint): boolean {
  switch (endpoint.kind) {
    case 'fqdn':
    case 'entity':
    case 'service':
      return true;
    default:
      return false;
  }
}
