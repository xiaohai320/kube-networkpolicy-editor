import yaml from 'js-yaml';
import type { DumpOptions } from 'js-yaml';
import type {
  Direction,
  Endpoint,
  LabelSelector,
  MatchExpression,
  Policy,
  PolicySpec,
  PortRule,
} from '@/types/policy';
import { isK8sUnrepresentable } from '@/types/policy';
import { ALL_NAMESPACES, KUBE_DNS, NAMESPACE_NAME_LABEL } from './label-utils';

interface K8sPort {
  port: number | string;
  protocol: string;
}

interface K8sPeer {
  ipBlock?: { cidr: string; except?: string[] };
  namespaceSelector?: Record<string, unknown>;
  podSelector?: Record<string, unknown>;
}

interface K8sRule {
  from?: K8sPeer[];
  to?: K8sPeer[];
  ports?: K8sPort[];
}

const ZERO_CIDR = '0.0.0.0/0';

function k8sSelector(labels?: Record<string, string>, expressions?: MatchExpression[]): Record<string, unknown> {
  if (!labels && !expressions) return {};
  const out: Record<string, unknown> = {};
  if (labels && Object.keys(labels).length > 0) out.matchLabels = { ...labels };
  if (expressions && expressions.length > 0) out.matchExpressions = expressions;
  return out;
}

function k8sPorts(ports: PortRule[]): K8sPort[] | undefined {
  if (ports.length === 0) return undefined;
  return ports.map(p => ({
    port: typeof p.port === 'string' && /^\d+$/.test(p.port) ? Number(p.port) : p.port,
    protocol: p.protocol,
  }));
}

/**
 * Kubernetes peers are namespace-local: a bare `podSelector` matches pods in
 * this policy's namespace only. Cross-namespace selection needs a
 * `namespaceSelector`, so the group decides which field is emitted.
 */
function buildPeer(endpoint: Endpoint): K8sPeer {
  switch (endpoint.kind) {
    case 'all':
      // A peer with no `namespaceSelector` is confined to this policy's own
      // namespace; adding `namespaceSelector: {}` widens it to the whole
      // cluster. Getting these two backwards changes a namespace policy into a
      // cluster policy, so the distinction is easy to miss.
      switch (endpoint.group) {
        case 'outside':
          return { ipBlock: { cidr: ZERO_CIDR } };
        case 'namespace':
          return { podSelector: {} };
        case 'cluster':
          return { namespaceSelector: {} };
      }
      break;

    case 'cidr':
      if (!endpoint.cidr) return {};
      return {
        ipBlock: {
          cidr: endpoint.cidr,
          ...(endpoint.except && endpoint.except.length > 0 ? { except: endpoint.except } : {}),
        },
      };

    case 'labels': {
      // Namespace-local: pods in this policy's own namespace. A bare
      // `podSelector` never leaves the namespace, so the `namespace` group
      // needs nothing beyond the pod labels — there is no namespace to choose.
      if (endpoint.group !== 'cluster') {
        return { podSelector: k8sSelector(endpoint.podSelector, endpoint.podExpressions) };
      }
      // Cross-namespace: `namespaceSelector` is what widens a peer beyond the
      // policy's own namespace, which is what the `cluster` group is for.
      const nsLabels = { ...(endpoint.namespaceSelector ?? {}) };
      if (endpoint.namespace && endpoint.namespace !== ALL_NAMESPACES) {
        nsLabels[NAMESPACE_NAME_LABEL] = endpoint.namespace;
      }
      return {
        namespaceSelector:
          Object.keys(nsLabels).length > 0 ? { matchLabels: nsLabels } : {},
        podSelector: k8sSelector(endpoint.podSelector, endpoint.podExpressions),
      };
    }

    case 'kube-dns':
      return {
        namespaceSelector: { matchLabels: { [NAMESPACE_NAME_LABEL]: KUBE_DNS.namespace } },
        podSelector: { matchLabels: { [KUBE_DNS.labelKey]: KUBE_DNS.labelValue } },
      };

    // fqdn / entity / service are unrepresentable and are filtered before we get here.
    case 'fqdn':
    case 'entity':
    case 'service':
      return {};
  }
  return {};
}

/**
 * Rules for one direction, or `null` when the field must be omitted. Kubernetes
 * expresses deny-all through `policyTypes` alone, so an empty rule list with
 * default-deny still emits the policyType — that is handled by the caller.
 */
function rulesFor(spec: PolicySpec, direction: Direction): Array<K8sRule | string> | null {
  const endpoints = direction === 'ingress' ? spec.ingress : spec.egress;
  if (endpoints.length === 0) return null;

  const representable = endpoints.filter(e => !isK8sUnrepresentable(e));
  if (representable.length === 0) return null;

  const prefix = direction === 'ingress' ? 'from' : 'to';
  return representable.map(endpoint => {
    const rule: K8sRule = { [prefix]: [buildPeer(endpoint)] };
    const ports = k8sPorts(endpoint.ports);
    if (ports) rule.ports = ports;
    return rule;
  });
}

function policyTypesFor(spec: PolicySpec): string[] {
  const types: string[] = [];
  if (spec.ingress.length > 0 || spec.defaultDenyIngress) types.push('Ingress');
  if (spec.egress.length > 0 || spec.defaultDenyEgress) types.push('Egress');
  return types;
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

function isEmptyK8sSelector(sel: LabelSelector): boolean {
  return (
    !sel ||
    (Object.keys(sel.matchLabels ?? {}).length === 0 && (sel.matchExpressions ?? []).length === 0)
  );
}

function omittedNote(direction: Direction): string {
  return `# omitted: this ${direction} rule cannot be expressed in a Kubernetes NetworkPolicy — see the Cilium tab`;
}

interface SpecDocument {
  doc: Record<string, unknown>;
  /** Directions whose rules were all dropped and therefore carry a note. */
  omitted: Direction[];
}

function specToDocument(policy: Policy, spec: PolicySpec, name?: string): SpecDocument {
  const out: Record<string, unknown> = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: name ?? policy.name, namespace: policy.namespace },
    spec: {
      podSelector: isEmptyK8sSelector(spec.endpointSelector) ? {} : spec.endpointSelector,
    },
  };

  const specObj = out.spec as Record<string, unknown>;

  const policyTypes = policyTypesFor(spec);
  if (policyTypes.length > 0) specObj.policyTypes = policyTypes;

  const omitted: Direction[] = [];
  for (const direction of ['ingress', 'egress'] as Direction[]) {
    const endpoints = direction === 'ingress' ? spec.ingress : spec.egress;
    const dropped = endpoints.filter(e => isK8sUnrepresentable(e));
    const rules = rulesFor(spec, direction);

    if (rules === null) {
      // Nothing to write. If rules were dropped, keep an explicit empty list so
      // the direction stays denied rather than silently allowing everything.
      if (dropped.length === 0) continue;
      specObj[direction] = [];
    } else {
      specObj[direction] = rules;
    }
    if (dropped.length > 0) omitted.push(direction);
  }

  return { doc: out, omitted };
}

function annotateUnsupported(yamlText: string, omitted: Direction[]): string {
  for (const direction of omitted) {
    // A comment directly above the key: a bare comment as a list item would
    // not be valid YAML, so it is not placed inside the rule list.
    yamlText = yamlText.replace(
      new RegExp(`^([ ]+)${direction}:`, 'm'),
      (_match, indent: string) => `${indent}${omittedNote(direction)}\n${indent}${direction}:`,
    );
  }
  return yamlText;
}

/**
 * Kubernetes policies have a single `podSelector`, so a policy holding several
 * Cilium `specs[]` groups is exported as a multi-document YAML stream, one
 * NetworkPolicy per group.
 */
export function generateK8sYaml(policy: Policy): string {
  const specs = policy.specs.length > 0 ? policy.specs : [createEmptySpec()];
  return specs
    .map((spec, i) => {
      const built = specToDocument(policy, spec, specs.length > 1 ? `${policy.name}-${i + 1}` : undefined);
      return annotateUnsupported(yaml.dump(built.doc, DUMP_OPTIONS), built.omitted);
    })
    .join('\n---\n');
}

function createEmptySpec(): PolicySpec {
  return {
    id: '',
    endpointSelector: {},
    ingress: [],
    egress: [],
    defaultDenyIngress: false,
    defaultDenyEgress: false,
  };
}
