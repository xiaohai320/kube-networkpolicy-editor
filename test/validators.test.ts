import { beforeAll, describe, expect, it } from 'vitest';
import type { Policy } from '@/types/policy';
import type { PolicyWarning } from '@/lib/validators';
import {
  computeWarnings,
  findDuplicateRules,
  selectorWarnings,
  validateCidr,
  validateExceptCidr,
  validateFqdn,
  validateLabelKey,
  validateLabelValue,
  validateNamespace,
  validatePolicyName,
  validatePort,
} from '@/lib/validators';
import { ep, policy, PORT_HTTP, resetIds } from './helpers';

beforeAll(resetIds);

describe('validatePolicyName', () => {
  it('accepts a DNS-1123 subdomain', () => {
    expect(validatePolicyName('my-network-policy')).toBeNull();
    expect(validatePolicyName('a')).toBeNull();
    expect(validatePolicyName('frontend-app-2')).toBeNull();
  });

  it('rejects empty, uppercase and underscored names', () => {
    expect(validatePolicyName('')).not.toBeNull();
    expect(validatePolicyName('   ')).not.toBeNull();
    expect(validatePolicyName('My-Policy')).not.toBeNull();
    expect(validatePolicyName('my_policy')).not.toBeNull();
    expect(validatePolicyName('-leading-hyphen')).not.toBeNull();
    expect(validatePolicyName('trailing-hyphen-')).not.toBeNull();
  });

  it('enforces the 253 character limit', () => {
    expect(validatePolicyName('a'.repeat(253))).toBeNull();
    expect(validatePolicyName('a'.repeat(254))).not.toBeNull();
  });
});

describe('validateNamespace', () => {
  it('accepts a valid namespace', () => {
    expect(validateNamespace('default')).toBeNull();
    expect(validateNamespace('kube-system')).toBeNull();
  });

  it('rejects invalid namespaces', () => {
    expect(validateNamespace('')).not.toBeNull();
    expect(validateNamespace('kube_system')).not.toBeNull();
    expect(validateNamespace('a'.repeat(64))).not.toBeNull();
  });
});

describe('validateLabelKey', () => {
  it('accepts plain and prefixed keys', () => {
    expect(validateLabelKey('app')).toBeNull();
    expect(validateLabelKey('app.kubernetes.io/name')).toBeNull();
    expect(validateLabelKey('a-b.c_d')).toBeNull();
  });

  it('rejects malformed keys', () => {
    expect(validateLabelKey('')).not.toBeNull();
    expect(validateLabelKey('a/b/c')).not.toBeNull();
    expect(validateLabelKey('_leading')).not.toBeNull();
    expect(validateLabelKey('trailing-')).not.toBeNull();
    expect(validateLabelKey('a' + '-'.repeat(64))).not.toBeNull();
  });

  it('checks the prefix and the name part separately', () => {
    expect(validateLabelKey('k8s:app')).not.toBeNull(); // `:` is not a label character
    expect(validateLabelKey('123invalid-prefix/app')).not.toBeNull();
    expect(validateLabelKey('good-prefix/')).not.toBeNull();
  });
});

describe('validateLabelValue', () => {
  it('accepts empty values (used with Exists) and normal ones', () => {
    expect(validateLabelValue('')).toBeNull();
    expect(validateLabelValue('frontend')).toBeNull();
    expect(validateLabelValue('a.b-c_d')).toBeNull();
  });

  it('rejects values that do not start or end with an alphanumeric', () => {
    expect(validateLabelValue('_leading')).not.toBeNull();
    expect(validateLabelValue('trailing-')).not.toBeNull();
    expect(validateLabelValue('a'.repeat(64))).not.toBeNull();
  });
});

describe('validateCidr', () => {
  it('accepts valid CIDRs', () => {
    expect(validateCidr('10.0.0.0/8')).toBeNull();
    expect(validateCidr('0.0.0.0/0')).toBeNull();
    expect(validateCidr('192.168.1.1/32')).toBeNull();
  });

  it('rejects malformed CIDRs', () => {
    expect(validateCidr('')).not.toBeNull();
    expect(validateCidr('10.0.0.0')).not.toBeNull();
    expect(validateCidr('256.0.0.0/8')).not.toBeNull();
    expect(validateCidr('10.0.0.0/33')).not.toBeNull();
    expect(validateCidr('10.0.0.0/-1')).not.toBeNull();
    expect(validateCidr('10.0.0.0/8x')).not.toBeNull();
  });
});

describe('validateExceptCidr', () => {
  it('accepts a subset of the main CIDR', () => {
    expect(validateExceptCidr('10.1.0.0/16', '10.0.0.0/8')).toBeNull();
    expect(validateExceptCidr('10.0.0.0/8', '10.0.0.0/8')).toBeNull();
  });

  it('rejects an exception outside the main CIDR', () => {
    expect(validateExceptCidr('192.168.0.0/16', '10.0.0.0/8')).not.toBeNull();
    expect(validateExceptCidr('10.0.0.0/4', '10.0.0.0/8')).not.toBeNull();
    expect(validateExceptCidr('not-a-cidr', '10.0.0.0/8')).not.toBeNull();
  });

  it('accepts an exception when there is no main CIDR to compare against', () => {
    expect(validateExceptCidr('192.168.0.0/16', undefined)).toBeNull();
  });
});

describe('validatePort', () => {
  it('accepts numeric ports', () => {
    expect(validatePort(80)).toBeNull();
    expect(validatePort(1)).toBeNull();
    expect(validatePort(65535)).toBeNull();
    expect(validatePort('443')).toBeNull();
  });

  it('rejects out-of-range and non-integer ports', () => {
    expect(validatePort(0)).not.toBeNull();
    expect(validatePort(65536)).not.toBeNull();
    expect(validatePort(-1)).not.toBeNull();
    expect(validatePort(80.5)).not.toBeNull();
    expect(validatePort('')).not.toBeNull();
  });

  it('accepts and validates Cilium port ranges', () => {
    expect(validatePort('5000:5100')).toBeNull();
    expect(validatePort('5000:5000')).toBeNull();
    expect(validatePort('5100:5000')).not.toBeNull();
    expect(validatePort('70000:70001')).not.toBeNull();
  });

  it('accepts Kubernetes named ports', () => {
    expect(validatePort('http')).toBeNull();
    expect(validatePort('web-1')).toBeNull();
    expect(validatePort('HTTP')).not.toBeNull();
    expect(validatePort('1abc')).not.toBeNull();
    expect(validatePort('a'.repeat(16))).not.toBeNull();
  });
});

describe('validateFqdn', () => {
  it('accepts hostnames and leading-wildcard patterns', () => {
    expect(validateFqdn('api.example.com', false)).toBeNull();
    expect(validateFqdn('*.example.com', true)).toBeNull();
    expect(validateFqdn('example.com.', false)).toBeNull();
  });

  it('rejects wildcards anywhere but a leading `*.`', () => {
    expect(validateFqdn('example.*.com', true)).not.toBeNull();
    expect(validateFqdn('example.com*', true)).not.toBeNull();
    expect(validateFqdn('example.com*', false)).not.toBeNull();
  });

  it('rejects malformed hostnames', () => {
    expect(validateFqdn('', false)).not.toBeNull();
    expect(validateFqdn('', true)).not.toBeNull();
    expect(validateFqdn('has space.com', false)).not.toBeNull();
    expect(validateFqdn('UPPER.com', false)).not.toBeNull();
    expect(validateFqdn('-leading.com', false)).not.toBeNull();
  });
});

describe('findDuplicateRules', () => {
  it('flags both copies of an identical pair', () => {
    const a = ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] });
    const b = ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] });
    const c = ep('cidr', 'outside', { cidr: '10.0.0.0/8' });
    expect(findDuplicateRules([a, b, c])).toEqual(new Set([a.id, b.id]));
  });

  it('does not flag rules that differ by port or group', () => {
    const a = ep('cidr', 'outside', { cidr: '10.0.0.0/8' });
    const b = ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] });
    const c = ep('cidr', 'cluster', { cidr: '10.0.0.0/8' });
    expect(findDuplicateRules([a, b, c])).toEqual(new Set());
  });

  it('separates kube-dns from every other kind of peer', () => {
    expect(findDuplicateRules([ep('kube-dns', 'cluster'), ep('all', 'cluster')])).toEqual(new Set());
  });
});

describe('selectorWarnings', () => {
  // The `label` is now a message, so the test passes a key like the app does.
  const label = { key: 'field-pod-selector' } as const;
  const sel = (extra: Record<string, unknown> = {}) => ({ matchLabels: { app: 'web' }, ...extra });

  it('accepts a valid selector', () => {
    expect(selectorWarnings(sel(), label)).toEqual([]);
  });

  it('reports In/NotIn without values as an error', () => {
    const warnings = selectorWarnings(sel({ matchExpressions: [{ key: 'tier', operator: 'In', values: [] }] }), label);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'error',
      msg: { key: 'selector-needs-value', params: { key: 'tier', operator: 'In' } },
    });
  });

  it('reports Exists/DoesNotExist carrying values as an error', () => {
    const warnings = selectorWarnings(
      sel({ matchExpressions: [{ key: 'tier', operator: 'Exists', values: ['x'] }] }),
      label,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'error',
      msg: { key: 'selector-no-value', params: { key: 'tier', operator: 'Exists' } },
    });
  });

  it('accepts Exists with no values', () => {
    expect(
      selectorWarnings(sel({ matchExpressions: [{ key: 'tier', operator: 'Exists', values: [] }] }), label),
    ).toEqual([]);
  });

  it('flags invalid label keys and values', () => {
    // `_` is legal in a label name, so a space is the actual offender here.
    const warnings = selectorWarnings({ matchLabels: { 'bad key': 'x' } }, label);
    expect(warnings.some(w => w.msg.key === 'label-key-invalid' && w.msg.params?.value === 'bad key')).toBe(true);
  });
});

function warningsFor(specOverrides: Parameters<typeof policy>[1], overrides: Partial<Policy> = {}): PolicyWarning[] {
  return computeWarnings(policy(overrides, specOverrides));
}

describe('computeWarnings', () => {
  it('stays quiet for a policy with a well-formed rule', () => {
    const warnings = warningsFor({
      ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] })],
    });
    expect(warnings).toEqual([]);
  });

  it('flags an empty policy as having no effect', () => {
    const warnings = warningsFor({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 'info', msg: { key: 'summary-empty-policy' } });
  });

  it('reports duplicates per direction', () => {
    const a = ep('cidr', 'outside', { cidr: '10.0.0.0/8' });
    const b = ep('cidr', 'outside', { cidr: '10.0.0.0/8' });
    const warnings = warningsFor({ ingress: [a, b] });
    expect(warnings.some(w => w.msg.key === 'summary-duplicate-ingress')).toBe(true);
  });

  it('warns about K8s-unrepresentable peers only in the K8s format', () => {
    const spec = { egress: [ep('fqdn', 'outside', { matchName: 'api.example.com' })] };
    const k8s = warningsFor(spec, { format: 'k8s' });
    const cilium = warningsFor(spec, { format: 'cilium' });
    expect(k8s.some(w => w.msg.key === 'summary-k8s-unrepresentable')).toBe(true);
    expect(cilium.some(w => w.msg.key === 'summary-k8s-unrepresentable')).toBe(false);
  });

  it('warns when an FQDN is placed on the ingress side', () => {
    const warnings = warningsFor({ ingress: [ep('fqdn', 'outside', { matchPattern: '*.example.com' })] });
    expect(warnings.some(w => w.msg.key === 'summary-fqdn-ingress')).toBe(true);
  });

  it('warns about 0.0.0.0/0 and about being open to the internet', () => {
    const warnings = warningsFor({ ingress: [ep('all', 'outside')] });
    expect(warnings.some(w => w.msg.key === 'summary-open-internet')).toBe(true);
  });

  it('warns about a labels peer matching all namespaces', () => {
    const warnings = warningsFor({
      ingress: [ep('labels', 'cluster', { namespace: '*', podSelector: { app: 'api' } })],
    });
    expect(warnings.some(w => w.msg.key === 'summary-all-namespaces')).toBe(true);
  });

  it('reports invalid fields with the offending rule id', () => {
    const bad = ep('cidr', 'outside', { cidr: 'not-a-cidr' });
    const warnings = warningsFor({ egress: [bad] });
    expect(warnings.some(w => w.ruleId === bad.id && w.level === 'error')).toBe(true);
  });

  it('validates the policy name and namespace', () => {
    const warnings = computeWarnings(policy({ name: 'BAD NAME' }));
    expect(warnings.some(w => w.msg.key === 'name-invalid')).toBe(true);
  });

  it('surfaces selector errors for every spec', () => {
    const p = policy({}, {
      endpointSelector: { matchExpressions: [{ key: 'tier', operator: 'In', values: [] }] },
      ingress: [ep('all', 'namespace')],
    });
    expect(computeWarnings(p).some(w => w.level === 'error')).toBe(true);
  });
});
