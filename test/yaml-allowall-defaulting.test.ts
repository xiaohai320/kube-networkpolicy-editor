/**
 * Regression: a K8s NetworkPolicy where both directions are allow-all used to
 * emit a bare spec (no policyTypes, no rule lists). The apiserver defaults an
 * omitted policyTypes to [Ingress], which silently flipped "allow everything"
 * into "deny all ingress" once applied. The generator now pins ingress open
 * with a peerless rule (`ingress: [{}]`, allows every source — verified live
 * against the apiserver) + policyTypes [Ingress].
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
    // A peerless rule (`- {}` in YAML) allows every source.
    expect(yaml).toContain('- {}');
    // Round trip: still parses as allow-all ingress (a rule, not a deny flag).
    const rt = parseK8sYaml(yaml);
    expect(rt.specs[0]!.defaultDenyIngress).toBe(false);
    expect(rt.specs[0]!.ingress.length).toBe(1);
    // The pin must read as all sources, not as a CIDR endpoint.
    expect(rt.specs[0]!.ingress[0]).toMatchObject({ group: 'outside', kind: 'all' });
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
