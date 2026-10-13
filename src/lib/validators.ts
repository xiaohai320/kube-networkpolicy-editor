/**
 * Validation utilities for the policy model.
 *
 * Each `validate*` helper returns a message key plus interpolation values, or
 * `null` when the input is valid. None of them assemble a sentence: the UI
 * interpolates the key through i18n, so these stay free of any locale and
 * `computeWarnings` can be exercised from a node test.
 */

import type { Msg } from '@/i18n';
import type { Direction, Endpoint, LabelSelector, Policy, PolicySpec } from '@/types/policy';
import { isK8sUnrepresentable } from '@/types/policy';
import { ALL_NAMESPACES, formatLabels, selectorFingerprint } from './label-utils';
import { endpointSummary } from './summarize';

// ── Metadata ─────────────────────────────────────────────────────────

const DNS_SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validatePolicyName(name: string): Msg | null {
  const trimmed = name.trim();
  if (!trimmed) return { key: 'name-required' };
  if (trimmed.length > 253) return { key: 'name-too-long' };
  if (!DNS_SUBDOMAIN_RE.test(trimmed)) return { key: 'name-invalid' };
  return null;
}

export function validateNamespace(ns: string): Msg | null {
  const trimmed = ns.trim();
  if (!trimmed) return { key: 'namespace-required' };
  if (trimmed.length > 63) return { key: 'namespace-too-long' };
  if (!DNS_SUBDOMAIN_RE.test(trimmed)) return { key: 'namespace-invalid' };
  return null;
}

// ── Labels ───────────────────────────────────────────────────────────

const LABEL_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
/** The `/` prefix must be an RFC 1123 subdomain, which cannot start with a digit. */
const LABEL_PREFIX_RE = /^[a-z]([a-z0-9.-]*[a-z0-9])?$/;
/** The name half of a prefixed key, per the Kubernetes label rules. */
const LABEL_SEGMENT_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const LABEL_VALUE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?)?$/;

export function validateLabelKey(key: string): Msg | null {
  if (!key) return { key: 'label-key-required' };

  const parts = key.split('/');
  if (parts.length > 2) return { key: 'label-key-separators' };

  if (parts.length === 2) {
    // Defaults make the octets definite without non-null assertions.
    const [prefix = '', name = ''] = parts;
    if (prefix.length > 253) return { key: 'label-prefix-too-long' };
    if (!LABEL_PREFIX_RE.test(prefix)) return { key: 'label-prefix-invalid' };
    if (!name || name.length > 63) return { key: 'label-name-length' };
    if (!LABEL_SEGMENT_RE.test(name)) return { key: 'label-name-invalid' };
  } else {
    if (key.length > 63) return { key: 'label-key-too-long' };
    if (!LABEL_NAME_RE.test(key)) return { key: 'label-alnum' };
  }

  return null;
}

export function validateLabelValue(value: string): Msg | null {
  if (value.length > 63) return { key: 'label-value-too-long' };
  if (!LABEL_VALUE_RE.test(value)) return { key: 'label-alnum' };
  return null;
}

/**
 * Cilium endpoint labels carry an explicit source prefix (`k8s:`,
 * `io.kubernetes.pod.namespace...`) that Kubernetes label syntax does not
 * permit. Validate the bare key for those.
 */
export function validateCiliumLabelKey(key: string): Msg | null {
  if (!key) return { key: 'label-key-required' };
  return validateLabelKey(key);
}

// ── CIDR ─────────────────────────────────────────────────────────────

function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = Number(p);
    return /^\d{1,3}$/.test(p) && n >= 0 && n <= 255;
  });
}

export function validateCidr(cidr: string): Msg | null {
  if (!cidr.trim()) return { key: 'cidr-required' };

  const parts = cidr.split('/');
  if (parts.length !== 2) return { key: 'cidr-prefix-required' };

  const [ip = '', prefixStr = ''] = parts;
  if (!isValidIPv4(ip)) return { key: 'cidr-invalid-ip' };

  const prefix = Number(prefixStr);
  if (!/^\d+$/.test(prefixStr) || prefix < 0 || prefix > 32) {
    return { key: 'cidr-prefix-invalid' };
  }

  return null;
}

export function validateExceptCidr(exceptCidr: string, mainCidr: string | undefined): Msg | null {
  const baseErr = validateCidr(exceptCidr);
  if (baseErr) return baseErr;

  if (mainCidr && !cidrContains(mainCidr, exceptCidr)) {
    return { key: 'cidr-exception-subset' };
  }

  return null;
}

/** Check if outer CIDR contains inner CIDR (simplified check by prefix length). */
function cidrContains(outer: string, inner: string): boolean {
  const [outerIp = '', outerPrefix = ''] = outer.split('/');
  const [innerIp = '', innerPrefix = ''] = inner.split('/');

  if (!outerIp || !innerIp || !outerPrefix || !innerPrefix) return false;

  const outerPrefixNum = Number(outerPrefix);
  const innerPrefixNum = Number(innerPrefix);

  // Inner prefix must be >= outer prefix (more specific or equal).
  if (innerPrefixNum < outerPrefixNum) return false;

  // Check that the network bits match.
  const outerNum = ipToNumber(outerIp);
  const innerNum = ipToNumber(innerIp);
  if (outerNum === null || innerNum === null) return false;

  const mask = outerPrefixNum === 0 ? 0 : (~0 << (32 - outerPrefixNum)) >>> 0;
  return (outerNum & mask) === (innerNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return null;
  if (parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// ── Ports ────────────────────────────────────────────────────────────

const PORT_RANGE_RE = /^(\d+):(\d+)$/;
const NAMED_PORT_RE = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

export function validatePort(port: string | number): Msg | null {
  if (typeof port === 'number') {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { key: 'port-range' };
    }
    return null;
  }

  const trimmed = port.trim();
  if (!trimmed) return { key: 'port-required' };

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (num < 1 || num > 65535) return { key: 'port-range' };
    return null;
  }

  // Cilium port range, e.g. `5000:5100`.
  const range = PORT_RANGE_RE.exec(trimmed);
  if (range) {
    const lo = Number(range[1] ?? '');
    const hi = Number(range[2] ?? '');
    if (lo < 1 || lo > 65535) return { key: 'port-range-start' };
    if (hi < 1 || hi > 65535) return { key: 'port-range-end' };
    if (hi < lo) return { key: 'port-range-order' };
    return null;
  }

  // Named port: must be a valid Kubernetes name.
  if (trimmed.length > 15) return { key: 'port-named-too-long' };
  if (!NAMED_PORT_RE.test(trimmed)) return { key: 'port-named-invalid' };
  return null;
}

/** FQDN pattern check: `matchPattern` supports a leading `*.` wildcard. */
export function validateFqdn(pattern: string, isPattern: boolean): Msg | null {
  const trimmed = pattern.trim();
  if (!trimmed) return { key: isPattern ? 'pattern-required' : 'hostname-required' };
  if (trimmed.includes(' ')) return { key: 'hostname-no-spaces' };
  if (trimmed.length > 253) return { key: 'hostname-too-long' };

  const labels = trimmed.split('.');
  for (const label of labels) {
    if (!label) continue; // trailing dot is allowed
    if (label.length > 63) return { key: 'hostname-label-too-long' };
    if (label === '*') continue; // wildcard is only legal at the start
    // Case-sensitive on purpose: DNS labels are lowercase.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { key: 'hostname-label-invalid' };
    }
  }
  if (isPattern && trimmed.includes('*') && !trimmed.startsWith('*.')) {
    return { key: 'hostname-wildcard-position' };
  }
  return null;
}

// ── Duplicate Detection ──────────────────────────────────────────────

export function findDuplicateRules(rules: Endpoint[]): Set<string> {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const rule of rules) {
    const key = endpointFingerprint(rule);
    const existingId = seen.get(key);
    if (existingId) {
      duplicates.add(existingId);
      duplicates.add(rule.id);
    } else {
      seen.set(key, rule.id);
    }
  }

  return duplicates;
}

function endpointFingerprint(rule: Endpoint): string {
  const parts: string[] = [rule.group, rule.kind];

  switch (rule.kind) {
    case 'cidr':
      parts.push(`cidr:${rule.cidr ?? ''}`);
      parts.push(`except:${[...(rule.except ?? [])].sort().join(',')}`);
      break;
    case 'fqdn':
      parts.push(`fqdn:${rule.matchPattern ?? ''}`);
      parts.push(`name:${rule.matchName ?? ''}`);
      break;
    case 'entity':
      parts.push(`entity:${rule.entity}`);
      break;
    case 'labels':
      parts.push(`ns:${rule.namespace ?? ''}`);
      parts.push(`pod:${selectorFingerprint({ matchLabels: rule.podSelector, matchExpressions: rule.podExpressions })}`);
      parts.push(`nsl:${selectorFingerprint({ matchLabels: rule.namespaceSelector, matchExpressions: rule.namespaceExpressions })}`);
      break;
    case 'service':
      parts.push(`svc:${rule.serviceName ?? ''}`);
      parts.push(`svcns:${rule.namespace ?? ''}`);
      parts.push(`svcsel:${selectorFingerprint({ matchLabels: rule.selector })}`);
      break;
    case 'all':
    case 'kube-dns':
      break;
  }

  parts.push(`ports:${[...rule.ports].map(p => `${p.port}/${p.protocol}`).sort().join(';')}`);
  return parts.join('|');
}

// ── Policy-Level Warnings ────────────────────────────────────────────

export interface PolicyWarning {
  level: 'error' | 'warning' | 'info';
  msg: Msg;
  ruleId?: string;
}

export function computeWarnings(policy: Policy): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];

  const nameErr = validatePolicyName(policy.name);
  if (nameErr) warnings.push({ level: 'error', msg: nameErr });

  const nsErr = validateNamespace(policy.namespace);
  if (nsErr) warnings.push({ level: 'error', msg: nsErr });

  for (const spec of policy.specs) {
    warnings.push(...computeSpecWarnings(spec, policy));
  }
  return warnings;
}

function computeSpecWarnings(spec: PolicySpec, policy: Policy): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];

  if (spec.ingress.length === 0 && spec.egress.length === 0 && !spec.defaultDenyIngress && !spec.defaultDenyEgress) {
    warnings.push({ level: 'info', msg: { key: 'summary-empty-policy' } });
  }

  const dupIngress = findDuplicateRules(spec.ingress);
  if (dupIngress.size > 0) {
    warnings.push({
      level: 'warning',
      msg: {
        key: 'summary-duplicate-ingress',
        params: { count: dupIngress.size / 2, suffix: dupIngress.size > 2 ? 's' : '' },
      },
    });
  }
  const dupEgress = findDuplicateRules(spec.egress);
  if (dupEgress.size > 0) {
    warnings.push({
      level: 'warning',
      msg: {
        key: 'summary-duplicate-egress',
        params: { count: dupEgress.size / 2, suffix: dupEgress.size > 2 ? 's' : '' },
      },
    });
  }

  for (const dir of ['ingress', 'egress'] as Direction[]) {
    for (const rule of dir === 'ingress' ? spec.ingress : spec.egress) {
      warnings.push(...endpointWarnings(rule, dir, policy.format));
    }
  }

  warnings.push(...selectorWarnings(spec.endpointSelector, { key: 'field-pod-selector' }));
  return warnings;
}

function endpointWarnings(rule: Endpoint, dir: Direction, format: Policy['format']): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  // A direction label is itself a message, so it is composed rather than
  // concatenated; `tr` resolves it before interpolating.
  const dirMsg: Msg = { key: dir === 'ingress' ? 'direction-ingress' : 'direction-egress' };

  if (format === 'k8s' && isK8sUnrepresentable(rule)) {
    warnings.push({
      level: 'warning',
      msg: { key: 'summary-k8s-unrepresentable', params: { endpoint: endpointSummary(rule) } },
      ruleId: rule.id,
    });
  }

  if (rule.kind === 'fqdn') {
    if (dir === 'ingress') {
      warnings.push({ level: 'warning', msg: { key: 'summary-fqdn-ingress' }, ruleId: rule.id });
    }
    const value = rule.matchPattern ?? rule.matchName ?? '';
    if (value) {
      const err = validateFqdn(value, Boolean(rule.matchPattern));
      if (err) {
        warnings.push({
          level: 'error',
          msg: { key: 'summary-fqdn-invalid', params: { label: dirMsg, message: err } },
          ruleId: rule.id,
        });
      }
    }
  }

  if (rule.kind === 'cidr') {
    if (rule.cidr) {
      const cidrErr = validateCidr(rule.cidr);
      if (cidrErr) {
        warnings.push({
          level: 'error',
          msg: { key: 'summary-cidr-invalid', params: { label: dirMsg, message: cidrErr } },
          ruleId: rule.id,
        });
      }
      if (rule.cidr === '0.0.0.0/0') {
        warnings.push({ level: 'warning', msg: { key: 'summary-open-cidr' }, ruleId: rule.id });
      }
    } else {
      warnings.push({
        level: 'error',
        msg: { key: 'summary-cidr-invalid', params: { label: dirMsg, message: { key: 'cidr-required' } } },
        ruleId: rule.id,
      });
    }
    for (const exc of rule.except ?? []) {
      const excErr = validateExceptCidr(exc, rule.cidr);
      if (excErr) {
        warnings.push({
          level: 'error',
          msg: {
            key: 'summary-exception-invalid',
            params: { label: dirMsg, value: exc, message: excErr },
          },
          ruleId: rule.id,
        });
      }
    }
  }

  for (const port of rule.ports) {
    const portErr = validatePort(port.port);
    if (portErr) {
      warnings.push({
        level: 'error',
        msg: { key: 'summary-port-invalid', params: { label: dirMsg, value: port.port, message: portErr } },
        ruleId: rule.id,
      });
    }
  }

  const portKeys = rule.ports.map(p => `${p.port}/${p.protocol}`);
  if (new Set(portKeys).size < portKeys.length) {
    warnings.push({ level: 'warning', msg: { key: 'summary-duplicate-ports' }, ruleId: rule.id });
  }

  if (rule.ports.length === 0) {
    warnings.push({ level: 'info', msg: { key: 'summary-no-ports' }, ruleId: rule.id });
  }

  if (rule.kind === 'all' && rule.group === 'outside') {
    warnings.push({ level: 'warning', msg: { key: 'summary-open-internet' }, ruleId: rule.id });
  }

  if (rule.kind === 'labels') {
    warnings.push(
      ...selectorWarnings(
        { matchLabels: rule.podSelector, matchExpressions: rule.podExpressions },
        { key: 'selector-pod', params: { dir: dirMsg } },
        rule.id,
      ),
    );
    if (rule.namespace === ALL_NAMESPACES) {
      warnings.push({ level: 'warning', msg: { key: 'summary-all-namespaces' }, ruleId: rule.id });
    }
    if (formatLabels(rule.podSelector) === '' && (rule.podExpressions ?? []).length === 0) {
      warnings.push({ level: 'info', msg: { key: 'summary-empty-pod-selector' }, ruleId: rule.id });
    }
  }

  return warnings;
}

export function selectorWarnings(selector: LabelSelector, label: Msg, ruleId?: string): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];

  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) {
    const keyErr = validateLabelKey(k);
    if (keyErr) {
      warnings.push({
        level: 'error',
        msg: { key: 'label-key-invalid', params: { label, value: k, message: keyErr } },
        ruleId,
      });
    }
    const valErr = validateLabelValue(v);
    if (valErr) {
      warnings.push({
        level: 'error',
        msg: { key: 'label-value-invalid', params: { label, value: v, message: valErr } },
        ruleId,
      });
    }
  }

  for (const expr of selector.matchExpressions ?? []) {
    const keyErr = validateLabelKey(expr.key);
    if (keyErr) {
      warnings.push({
        level: 'error',
        msg: { key: 'label-key-invalid', params: { label, value: expr.key, message: keyErr } },
        ruleId,
      });
    }
    if ((expr.operator === 'In' || expr.operator === 'NotIn') && expr.values.length === 0) {
      warnings.push({
        level: 'error',
        msg: {
          key: 'selector-needs-value',
          params: { label, key: expr.key, operator: expr.operator },
        },
        ruleId,
      });
    }
    if ((expr.operator === 'Exists' || expr.operator === 'DoesNotExist') && expr.values.length > 0) {
      warnings.push({
        level: 'error',
        msg: { key: 'selector-no-value', params: { label, key: expr.key, operator: expr.operator } },
        ruleId,
      });
    }
    for (const v of expr.values ?? []) {
      const valErr = validateLabelValue(v);
      if (valErr) {
        warnings.push({
          level: 'error',
          msg: { key: 'label-value-invalid', params: { label, value: v, message: valErr } },
          ruleId,
        });
      }
    }
  }

  return warnings;
}
