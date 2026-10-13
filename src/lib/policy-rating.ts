import type { Direction, Endpoint, Policy, PolicySpec } from '@/types/policy';

/**
 * Policy strictness, 1 (loosest) to 4 (strictest).
 *
 * 1 — no rules at all
 * 2 — only one direction covered
 * 3 — both directions, but at least one rule is broad
 * 4 — both directions, every rule narrowly scoped with ports restricted
 */
export function computeRating(policy: Policy): 1 | 2 | 3 | 4 {
  const specs = policy.specs.length > 0 ? policy.specs : [];
  const ingress = specs.flatMap(s => s.ingress);
  const egress = specs.flatMap(s => s.egress);

  if (ingress.length === 0 && egress.length === 0) return 1;
  if (ingress.length === 0 || egress.length === 0) return 2;

  const allRules = [...ingress, ...egress];
  return allRules.every(isSpecific) ? 4 : 3;
}

/** True when a rule names a narrow peer AND restricts its ports. */
function isSpecific(rule: Endpoint): boolean {
  const hasPeerScope = isNarrowPeer(rule);
  const hasPorts = rule.ports.length > 0;
  return hasPeerScope && hasPorts;
}

function isNarrowPeer(rule: Endpoint): boolean {
  switch (rule.kind) {
    case 'all':
      // `all` is narrow only inside this policy's own namespace scope.
      return false;
    case 'cidr':
      return Boolean(rule.cidr) && rule.cidr !== '0.0.0.0/0';
    case 'fqdn':
      return Boolean(rule.matchName || rule.matchPattern);
    case 'entity':
      // host / remote-node are cluster-scoped and quite broad.
      return false;
    case 'kube-dns':
      return true;
    case 'labels':
      return (
        Object.keys(rule.podSelector ?? {}).length > 0 ||
        (rule.podExpressions ?? []).length > 0 ||
        Boolean(rule.namespace)
      );
    case 'service':
      return Boolean(rule.serviceName || rule.selector || rule.namespace);
  }
}

/** Rating used for a single rule, so the canvas can colour cards. */
export function rateEndpoint(rule: Endpoint, _direction: Direction): 1 | 2 | 3 | 4 {
  void _direction;
  switch (rule.kind) {
    case 'all':
      return rule.group === 'cluster' ? 2 : 1;
    case 'cidr':
      if (!rule.cidr) return 1;
      if (rule.cidr === '0.0.0.0/0') return 1;
      return rule.ports.length > 0 ? 4 : 3;
    case 'fqdn':
      return rule.ports.length > 0 ? 4 : 3;
    case 'entity':
      return rule.ports.length > 0 ? 3 : 2;
    case 'kube-dns':
      return rule.ports.length > 0 ? 4 : 3;
    case 'labels':
      return rule.ports.length > 0 ? 4 : 3;
    case 'service':
      return rule.ports.length > 0 ? 4 : 3;
  }
}

/** Convenience: a spec's rating from its own rules. */
export function rateSpec(spec: PolicySpec): 1 | 2 | 3 | 4 {
  const all = [...spec.ingress, ...spec.egress];
  if (all.length === 0) return 1;
  return computeRating({ id: '', name: '', namespace: '', format: 'cilium', specs: [spec] });
}
