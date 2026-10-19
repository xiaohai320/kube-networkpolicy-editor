/**
 * Regression: a K8s NetworkPolicy where both directions are allow-all used to
 * emit a bare spec (no policyTypes, no rule lists). The apiserver defaults an
 * omitted policyTypes to [Ingress], which silently flipped "allow everything"
 * into "deny all ingress" once applied. The generator now pins ingress open
 * with an explicit ipBlock 0.0.0.0/0 rule + policyTypes [Ingress].
 */
import { describe, expect, it } from 'vitest';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { createDefaultPolicy } from '@/types/policy';
import { parseK8sYaml } from '@/lib/yaml-parser';

describe('k8s allow-all defaulting pin', () => {
  it('both directions allow-all emits explicit policyTypes + pinned allow rule', () => {
    const policy = createDefaultPolicy({ format: 'k8s' });
    policy.namespace = 'demo';
    const yaml = generateK8sYaml(policy);
    expect(yaml).toContain('policyTypes:');
    expect(yaml).toContain('0.0.0.0/0');
    // Round trip: still parses as allow-all ingress (a rule, not a deny flag)
    const rt = parseK8sYaml(yaml);
    expect(rt.specs[0]!.defaultDenyIngress).toBe(false);
    expect(rt.specs[0]!.ingress.length).toBe(1);
  });

  it('ingress deny-all + egress allow-all still emits bare [Ingress] (no pin)', () => {
    const policy = createDefaultPolicy({ format: 'k8s' });
    policy.specs[0]!.defaultDenyIngress = true;
    const yaml = generateK8sYaml(policy);
    expect(yaml).toContain('"Ingress"');
    expect(yaml).not.toContain('0.0.0.0/0');
  });

  it('ingress rules + egress allow-all keeps [Ingress] with the real rules', () => {
    const policy = createDefaultPolicy({ format: 'k8s' });
    policy.specs[0]!.ingress = [
      {
        id: 'r1',
        group: 'namespace',
        kind: 'labels',
        podSelector: { app: 'web' },
        ports: [],
      },
    ];
    const yaml = generateK8sYaml(policy);
    expect(yaml).toContain('"Ingress"');
    expect(yaml).not.toContain('0.0.0.0/0');
  });
});
