import { describe, it, expect } from 'vitest';
import { detectAndParse } from '@/lib/yaml-parser';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';

/**
 * HTTP L7 rules: method + path become editable, everything else on a toPorts
 * group's `rules` block routes to the unsupported channel (ADR-0002).
 */
describe('HTTP L7 round-trip', () => {
  const HTTP_POLICY = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-http
  namespace: default
spec:
  endpointSelector: {}
  egress:
    - toEndpoints:
        - matchLabels:
            "k8s:app": web
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: /api
`;

  it('parses method + path into the model', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const egress = policy.specs[0]!.egress;
    expect(egress).toHaveLength(1);
    const ep = egress[0]!;
    expect(ep.kind).toBe('labels');
    expect(ep.ports).toEqual([{ port: 80, protocol: 'TCP', http: { method: 'GET', path: '/api' } }]);
  });

  it('generates rules.http back from the model', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const yaml = generateCiliumYaml(policy);
    expect(yaml).toContain('http:');
    expect(yaml).toContain('method: "GET"');
    expect(yaml).toContain('path: "/api"');
  });

  it('round-trips without loss', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const yaml = generateCiliumYaml(policy);
    const { policy: reparsed } = detectAndParse(yaml);
    // Ids are random UUIDs regenerated on each parse — compare shape, not identity.
    const strip = (p: typeof policy) =>
      JSON.parse(JSON.stringify({ specs: p.specs, unsupported: p.unsupported }, (k, v) => (k === 'id' ? '<id>' : v)));
    expect(strip(reparsed)).toEqual(strip(policy));
    expect(reparsed.unsupported).toBeUndefined();
  });

  it('keeps headers-only L7 groups in the unsupported channel', () => {
    const withHeaders = HTTP_POLICY.replace(
      'http:\n              - method: GET\n                path: /api',
      'http:\n              - method: GET\n                path: /api\n                headers:\n                  - "X-Foo: bar"',
    );
    const { policy } = detectAndParse(withHeaders);
    // The whole toPorts group carries an unmodelable L7 block, so the rule goes
    // to unsupported verbatim; nothing silently drops the headers entry.
    expect(policy.unsupported?.egress).toHaveLength(1);
    const yaml = generateCiliumYaml(policy);
    expect(yaml).toContain('X-Foo: bar');
    expect(yaml).toContain('preserved: this editor cannot represent these egress rules');
  });

  it('k8s format is unaffected: l7 ports stay out of the K8s yaml', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const yaml = generateK8sYaml(policy);
    // The L7 filter itself must not leak into the K8s output (the policy *name*
    // legitimately contains "http", so assert on the ports block shape).
    expect(yaml).toMatch(/ports:\s*\n\s+- port: 80\s*\n\s+protocol: "TCP"\s*\n/);
    expect(yaml).not.toMatch(/rules:|method:/);
  });
});
