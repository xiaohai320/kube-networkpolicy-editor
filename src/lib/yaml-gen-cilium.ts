import yaml from 'js-yaml';
import type { DumpOptions } from 'js-yaml';
import type {
  Direction,
  Endpoint,
  LabelSelector,
  Policy,
  PolicySpec,
  PortRule,
} from '@/types/policy';
import {
  ENTITY_ENTITY,
  KUBE_DNS,
  NAMESPACE_LABEL,
  NAMESPACE_LABELS_PREFIX,
  ALL_NAMESPACES,
  addLabel,
  ciliumExpressionKey,
  isEmptySelector,
  toCiliumPodLabels,
} from './label-utils';
import { extractRuleMap, withRuleSentinel, type MappedYaml } from './yaml-rule-map';

type CiliumRule = Record<string, unknown>;

const ENTITY_FOR_ALL: Record<'outside' | 'cluster', string> = {
  outside: ENTITY_ENTITY.world,
  cluster: ENTITY_ENTITY.cluster,
};

/**
 * Build the toPorts *list*: consecutive ports share one entry, the way
 * hand-written policies spell them.
 */
function portGroups(ports: PortRule[]): CiliumRule[] | undefined {
  if (ports.length === 0) return undefined;
  return [{ ports: ports.map(p => ({ port: String(p.port), protocol: p.protocol })) }];
}

/**
 * The policy-level endpoint selector: Cilium needs the `k8s:` prefix on pod
 * labels, so the same normalization as peers applies here.
 */
function ciliumPolicySelector(selector: LabelSelector): LabelSelector {
  const matchLabels = toCiliumPodLabels(selector.matchLabels);
  const matchExpressions = (selector.matchExpressions ?? []).map(e => ({
    ...e,
    key: ciliumExpressionKey(e.key),
  }));
  return {
    matchLabels: Object.keys(matchLabels).length > 0 ? matchLabels : undefined,
    matchExpressions: matchExpressions.length > 0 ? matchExpressions : undefined,
  };
}

/**
 * Cilium endpoint label selector for a `labels` peer. Cilium has no implicit
 * namespace scoping: a selector naming only pod labels matches every endpoint
 * in every namespace that carries those labels. A peer scoped to the policy's
 * own namespace therefore has to name that namespace, which is the one place
 * the policy's own namespace leaks into a rule.
 */
function ciliumEndpointSelector(
  endpoint: Extract<Endpoint, { kind: 'labels' }>,
  policyNamespace: string,
): LabelSelector {
  const matchLabels: Record<string, string> = { ...toCiliumPodLabels(endpoint.podSelector) };
  if (endpoint.namespace !== ALL_NAMESPACES) {
    // `ALL_NAMESPACES` becomes an `Exists` expression below, not a label.
    const scopedNamespace = endpoint.namespace ?? (endpoint.group === 'namespace' ? policyNamespace : undefined);
    if (scopedNamespace) addLabel(matchLabels, NAMESPACE_LABEL, scopedNamespace);
  }
  for (const [key, value] of Object.entries(endpoint.namespaceSelector ?? {})) {
    addLabel(matchLabels, `${NAMESPACE_LABELS_PREFIX}${key}`, value);
  }

  const matchExpressions = [
    ...(endpoint.podExpressions ?? []).map(e => ({ ...e, key: ciliumExpressionKey(e.key) })),
    ...(endpoint.namespaceExpressions ?? []),
  ];
  if (endpoint.namespace === ALL_NAMESPACES) {
    matchExpressions.push({ key: NAMESPACE_LABEL, operator: 'Exists' as const, values: [] });
  }

  return {
    matchLabels: Object.keys(matchLabels).length > 0 ? matchLabels : undefined,
    matchExpressions: matchExpressions.length > 0 ? matchExpressions : undefined,
  };
}

/**
 * One endpoint in, one Cilium rule fragment out. Cilium spells both directions
 * with `toPorts`, so the port list is appended here for ingress rules too.
 */
function buildRule(
  endpoint: Endpoint,
  prefix: 'from' | 'to',
  policyNamespace: string,
): CiliumRule {
  const rule: CiliumRule = {};

  switch (endpoint.kind) {
    case 'all': {
      if (endpoint.group === 'namespace') {
        // All pods in this policy's own namespace. Cilium needs the namespace
        // named; `fromEndpoints: [{}]` would match every endpoint in the
        // cluster.
        rule[`${prefix}Endpoints`] = [{ matchLabels: { [NAMESPACE_LABEL]: policyNamespace } }];
      } else {
        const entity = ENTITY_FOR_ALL[endpoint.group];
        if (entity) rule[`${prefix}Entities`] = [entity];
      }
      break;
    }
    case 'cidr': {
      if (!endpoint.cidr) break;
      if (endpoint.except && endpoint.except.length > 0) {
        rule[`${prefix}CIDRSet`] = [{ cidr: endpoint.cidr, except: endpoint.except }];
      } else {
        rule[`${prefix}CIDR`] = [endpoint.cidr];
      }
      break;
    }
    case 'fqdn': {
      // Egress only: Cilium has no ingress FQDN equivalent.
      if (prefix !== 'to') break;
      const spec: Record<string, string> = {};
      if (endpoint.matchName) spec.matchName = endpoint.matchName;
      if (endpoint.matchPattern) spec.matchPattern = endpoint.matchPattern;
      if (Object.keys(spec).length > 0) rule.toFQDNs = [spec];
      break;
    }
    case 'entity': {
      rule[`${prefix}Entities`] = [ENTITY_ENTITY[endpoint.entity]];
      break;
    }
    case 'kube-dns': {
      // The kube-dns entity is the idiomatic form: no label prefixing involved.
      rule[`${prefix}Entities`] = [ENTITY_ENTITY['kube-dns']];
      break;
    }
    case 'labels': {
      const selector = ciliumEndpointSelector(endpoint, policyNamespace);
      rule[`${prefix}Endpoints`] = isEmptySelector(selector) ? [{}] : [selector];
      break;
    }
    case 'service': {
      const svc: Record<string, unknown> = {};
      if (endpoint.serviceName) {
        svc.k8sService = { namespace: endpoint.namespace, serviceName: endpoint.serviceName };
      } else {
        svc.k8sServiceSelector = {
          namespace: endpoint.namespace,
          selector: { matchLabels: endpoint.selector },
        };
      }
      rule[`${prefix}Services`] = [svc];
      break;
    }
  }

  const toPorts = portGroups(endpoint.ports);
  if (toPorts) rule.toPorts = toPorts;

  return rule;
}

/**
 * Rules for one direction, or `null` when the field should be omitted.
 *
 * Real Cilium semantics, as of this generator: a direction key ABSENT (or an
 * empty list, which is indistinguishable after JSON unmarshal) means the spec
 * does not define that direction — selected endpoints are NOT restricted by
 * it. A rule object with no fields (`ingress: [{}]`) is the allowAll wildcard
 * — it explicitly allows everything. Default-deny therefore must NOT be
 * spelled `[{}]` (that allows!); it is spelled as a rule in `ingressDeny` /
 * `egressDeny` — an empty deny rule denies everything, and deny rules also
 * enable enforcement for the direction.
 */
function rulesFor(
  spec: PolicySpec,
  direction: Direction,
  policyNamespace: string,
): Array<{ rule: CiliumRule; id: string | null }> | null {
  const prefix = direction === 'ingress' ? 'from' : 'to';
  const endpoints = direction === 'ingress' ? spec.ingress : spec.egress;

  // A rule stub that serializes to nothing (an unrepresentable peer) is
  // dropped: emitting an empty object would be an allowAll wildcard — the
  // exact opposite of the deny marker it used to be read as.
  const rules = endpoints
    .map(e => ({ rule: buildRule(e, prefix, policyNamespace), id: e.id }))
    .filter(r => Object.keys(r.rule).length > 0);
  return rules.length > 0 ? rules : null;
}

/**
 * The deny section for one direction, or `null` when it should be omitted.
 * The editor's default-deny badge emits an empty deny rule — Cilium's
 * "deny everything" spelling, which also turns enforcement on for the
 * direction. Note this deny is absolute: unlike a bare selected endpoint
 * (denied only until another policy allows something), ingressDeny denies
 * regardless of any allow rule anywhere. The badge's semantics say
 * "deny everything", so the stronger spelling matches intent.
 */
function denyRulesFor(spec: PolicySpec, direction: Direction): Array<CiliumRule> | null {
  const denied = direction === 'ingress' ? spec.defaultDenyIngress : spec.defaultDenyEgress;
  return denied ? [{}] : null;
}

interface SpecCilium {
  spec: Record<string, unknown>;
  /** Directions where imported rules had to be preserved as a comment. */
  unsupported: Direction[];
  /** Endpoint ids of the emitted rules, per direction, in emission order. */
  ruleIds: { ingress: string[]; egress: string[] };
}

function specToCilium(spec: PolicySpec, policy: Policy): SpecCilium {
  const endpointSelector = ciliumPolicySelector(spec.endpointSelector);
  const out: Record<string, unknown> = {
    endpointSelector: isEmptySelector(endpointSelector) ? {} : endpointSelector,
  };

  const unsupported: Direction[] = [];
  const ruleIds: SpecCilium['ruleIds'] = { ingress: [], egress: [] };

  for (const direction of ['ingress', 'egress'] as Direction[]) {
    const rules = rulesFor(spec, direction, policy.namespace);
    // Rules imported from YAML that the model cannot represent are appended
    // verbatim, so they survive the round trip instead of being dropped.
    const extra = policy.unsupported?.[direction] ?? [];

    if (rules === null && extra.length === 0) continue;
    const rulesOut = [
      ...(rules ?? []).map(({ rule, id }) => (id === null ? rule : withRuleSentinel(rule, id))),
      ...extra,
    ];
    if (rulesOut.length === 0) continue;
    out[direction] = rulesOut;
    if (rules !== null) ruleIds[direction] = rules.map(r => r.id).filter((id): id is string => id !== null);
    if (extra.length > 0) unsupported.push(direction);
  }

  // Deny sections: the badge's deny-all marker, plus deny rules the model
  // cannot represent, preserved verbatim in their own bucket (re-emitting
  // them into the allow lists would invert their meaning).
  for (const direction of ['ingress', 'egress'] as Direction[]) {
    const denyKey = direction === 'ingress' ? 'ingressDeny' : 'egressDeny';
    const denied = denyRulesFor(spec, direction);
    const denyExtra = policy.unsupported?.[denyKey] ?? [];
    if (denied === null && denyExtra.length === 0) continue;
    const denyOut = [...(denied ?? []), ...denyExtra];
    if (denyOut.length === 0) continue;
    out[denyKey] = denyOut;
    if (denyExtra.length > 0) unsupported.push(direction);
  }

  // The CRD's anyOf requires at least one of ingress/egress/ingressDeny/
  // egressDeny on the spec. Two cases still produce none:
  //   - both directions allow-all (nothing to write): the empty rule object
  //     below is an allowAll wildcard — it passes anyOf AND genuinely allows
  //     everything, even when another policy turns enforcement on.
  //   - (deny-all both is handled above: both deny keys are emitted.)
  // Only INGRESS gets the wildcard, and only because anyOf forces SOMETHING:
  // emitting egress too would silently define (enforce) egress on a policy
  // that never had it — an allow-all ingress CNP would open egress on a pure
  // open/save cycle. Ingress is the conventional side for the marker.
  if (!('ingress' in out) && !('egress' in out) && !('ingressDeny' in out) && !('egressDeny' in out)) {
    out.ingress = [{}];
  }

  return { spec: out, unsupported, ruleIds };
}

/**
 * `forceQuotes` matters here: js-yaml's default schema is YAML 1.1, so without
 * it a label value of `yes` would be written as a bare scalar and read back as
 * a boolean on import. Quoting every value closes that whole class of
 * round-trip corruption.
 */
const DUMP_OPTIONS: DumpOptions = {
  noRefs: true,
  lineWidth: -1,
  quotingType: '"',
  noCompatMode: true,
  forceQuotes: true,
};

function annotateUnsupported(yamlText: string, directions: Direction[]): string {
  for (const direction of directions) {
    // The comment goes above the key. A bare comment as a list item would not
    // be valid YAML, so it is never placed inside the rule list itself.
    yamlText = yamlText.replace(
      // `g`: with several `specs[]` groups each one has its own key to annotate.
      new RegExp(`^([ ]+)${direction}:`, 'mg'),
      (_match, indent: string) =>
        `${indent}# preserved: this editor cannot represent these ${direction} rules\n${indent}${direction}:`,
    );
  }
  return yamlText;
}

export function generateCiliumYaml(policy: Policy): string {
  return generateCiliumYamlMapped(policy).yaml;
}

/**
 * Same YAML text plus the hover-highlight rule map. Unlike the K8s generator
 * there is only ever one document: several selector groups ride in `specs[]`.
 */
export function generateCiliumYamlMapped(policy: Policy): MappedYaml {
  const manifest: Record<string, unknown> = {
    apiVersion: 'cilium.io/v2',
    kind: 'CiliumNetworkPolicy',
    metadata: { name: policy.name, namespace: policy.namespace },
  };

  const specs = policy.specs.map(s => specToCilium(s, policy));
  const note = specs.flatMap(s => s.unsupported);
  const value = specs.map(s => s.spec);
  manifest[policy.specs.length === 1 ? 'spec' : 'specs'] =
    policy.specs.length === 1 ? value[0] : value;

  const dumped = annotateUnsupported(yaml.dump(manifest, DUMP_OPTIONS), note);
  return extractRuleMap(dumped, 0);
}

/**
 * Default ports for a freshly authored kube-dns peer. Exported so the canvas
 * and the generators agree on what "Kubernetes DNS" means.
 */
export function kubeDnsDefaultPorts(): PortRule[] {
  return [
    { port: KUBE_DNS.port, protocol: 'UDP' },
    { port: KUBE_DNS.port, protocol: 'TCP' },
  ];
}
