import type {
  Endpoint,
  EndpointKind,
  LabelSelector,
  Policy,
  PolicySpec,
  PortRule,
  RuleGroup,
} from '@/types/policy';
import { createDefaultPolicy, newEndpoint } from '@/types/policy';

let counter = 0;

/** Sequential, deterministic ids so golden snapshots are stable. */
export function nextId(): string {
  counter += 1;
  return `id${counter}`;
}

export function resetIds(): void {
  counter = 0;
}

/** Build an endpoint with a stable id and a couple of convenient shortcuts. */
export function ep(
  kind: EndpointKind,
  group: RuleGroup,
  extra: Record<string, unknown> = {},
): Endpoint {
  const endpoint = newEndpoint(kind, group, extra);
  return { ...endpoint, id: nextId() } as Endpoint;
}

/** Build a policy from a spec, defaulting to the Cilium format. */
export function policy(
  overrides: Partial<Policy> = {},
  specOverrides: Partial<PolicySpec> = {},
): Policy {
  const p = createDefaultPolicy(overrides);
  const spec = p.specs[0]!;
  Object.assign(spec, specOverrides);
  spec.id = nextId();
  return p;
}

export function ports(list: PortRule[]): PortRule[] {
  return list;
}

export const PORT_HTTP: PortRule = { port: 80, protocol: 'TCP' };
export const PORT_HTTPS: PortRule = { port: 443, protocol: 'TCP' };
export const PORT_DNS_UDP: PortRule = { port: 53, protocol: 'UDP' };
export const PORT_DNS_TCP: PortRule = { port: 53, protocol: 'TCP' };

export function selectors(matchLabels?: Record<string, string>): LabelSelector {
  return matchLabels ? { matchLabels } : {};
}

export function emptyPolicySpec(): PolicySpec {
  return {
    id: nextId(),
    endpointSelector: {},
    ingress: [],
    egress: [],
    defaultDenyIngress: false,
    defaultDenyEgress: false,
  };
}

/** Strip ids so parsed output can be compared against an authored model. */
export function withoutIds<T>(value: T): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(withoutIds);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'id') continue;
    if (k === 'namespace' && (v === '' || v === undefined)) continue;
    if (k === 'selector' && typeof v === 'object' && v !== null && Object.keys(v).length === 0) continue;
    if (k === 'matchLabels' && typeof v === 'object' && v !== null && Object.keys(v).length === 0) continue;
    if (k === 'matchExpressions' && Array.isArray(v) && v.length === 0) continue;
    if (k === 'except' && Array.isArray(v) && v.length === 0) continue;
    out[k] = withoutIds(v);
  }
  const trimmed = Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined),
  );
  return trimmed;
}

export function specByGroup(
  endpoints: Endpoint[],
): Record<RuleGroup, Endpoint[]> {
  const out: Record<RuleGroup, Endpoint[]> = { outside: [], namespace: [], cluster: [] };
  for (const e of endpoints) out[e.group].push(e);
  return out;
}
