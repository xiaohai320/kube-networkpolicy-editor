/**
 * Regression for the user-reported flow: a CiliumNetworkPolicy where both
 * directions are allow-all used to emit a bare spec (endpointSelector only),
 * which the CNP CRD rejects — "spec must validate at least one schema
 * (anyOf), spec.ingress: Required value". The generator now emits allowAll
 * wildcard rules (ingress: [{}], egress: [{}]) — Cilium's documented
 * allow-everything spelling, which passes anyOf. The old reading of `[{}]`
 * as a deny marker was inverted (an empty ALLOW rule matches everything;
 * deny-all is `ingressDeny: [{}]` or an enforced bare selector).
 */
import { describe, expect, it } from 'vitest';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { createDefaultPolicy } from '@/types/policy';
import { parseCiliumYaml } from '@/lib/yaml-parser';

describe('cilium allow-all encoding', () => {
  it('both directions allow-all emits allowAll wildcards (passes CRD anyOf)', () => {
    const policy = createDefaultPolicy({ format: 'cilium' });
    policy.namespace = 'demo';
    const yaml = generateCiliumYaml(policy);
    expect(yaml).toContain('ingress:');
    expect(yaml).toContain('egress:');
    // Round trip: still allow-all in both directions, never a deny flag.
    const rt = parseCiliumYaml(yaml);
    expect(rt.specs[0]!.defaultDenyIngress).toBe(false);
    expect(rt.specs[0]!.defaultDenyEgress).toBe(false);
    // The wildcards import as explicit all/cluster peers.
    expect(rt.specs[0]!.ingress).toHaveLength(1);
    expect(rt.specs[0]!.ingress[0]!.kind).toBe('all');
  });

  it('default-deny ingress emits ingressDeny, never an allow wildcard', () => {
    const policy = createDefaultPolicy({ format: 'cilium' });
    policy.specs[0]!.defaultDenyIngress = true;
    const yaml = generateCiliumYaml(policy);
    expect(yaml).toContain('ingressDeny:');
    expect(yaml).not.toContain('ingress:');
    const rt = parseCiliumYaml(yaml);
    expect(rt.specs[0]!.defaultDenyIngress).toBe(true);
    expect(rt.specs[0]!.defaultDenyEgress).toBe(false);
  });

  it('a bare-selector CNP (deny both) parses as deny-all both', () => {
    // What the cluster enforces for a spec with no rule lists at all.
    const yaml = `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: deny
  namespace: demo
spec:
  endpointSelector: {}
`;
    const rt = parseCiliumYaml(yaml);
    expect(rt.specs[0]!.defaultDenyIngress).toBe(true);
    expect(rt.specs[0]!.defaultDenyEgress).toBe(true);
  });

  it('an ingress-only CNP leaves egress open (enforcement is per defined direction)', () => {
    const yaml = `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: web
  namespace: demo
spec:
  endpointSelector: {}
  ingress:
    - fromEntities:
        - "cluster"
`;
    const rt = parseCiliumYaml(yaml);
    expect(rt.specs[0]!.defaultDenyIngress).toBe(false);
    expect(rt.specs[0]!.defaultDenyEgress).toBe(false);
  });
});
