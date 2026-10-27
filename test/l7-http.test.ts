import { describe, it, expect } from 'vitest';
import { detectAndParse } from '@/lib/yaml-parser';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';

/**
 * The editor models L4 only: any toPorts group carrying an L7 `rules` block
 * (http, dns, kafka, tls…) routes to the unsupported channel verbatim
 * (ADR-0002) — parsed, never dropped, never half-captured.
 */
describe('L7 rules route to unsupported', () => {
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

  it('parses the peer but routes the L7 rule to unsupported', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    expect(policy.specs[0]!.egress).toHaveLength(0);
    expect(policy.unsupported?.egress).toHaveLength(1);
  });

  it('keeps the L7 rule verbatim on regeneration', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const yaml = generateCiliumYaml(policy);
    expect(yaml).toContain('http:');
    expect(yaml).toContain('method: "GET"');
    expect(yaml).toContain('path: "/api"');
    expect(yaml).toContain('preserved: this editor cannot represent these egress rules');
  });

  it('round-trips without loss', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const yaml = generateCiliumYaml(policy);
    const { policy: reparsed } = detectAndParse(yaml);
    // Ids are random UUIDs regenerated on each parse — compare shape, not identity.
    const strip = (p: typeof policy) =>
      JSON.parse(JSON.stringify({ specs: p.specs, unsupported: p.unsupported }, (k, v) => (k === 'id' ? '<id>' : v)));
    expect(strip(reparsed)).toEqual(strip(policy));
    expect(reparsed.unsupported?.egress).toHaveLength(1);
  });

  it('routes headers-only L7 groups to unsupported too', () => {
    const withHeaders = HTTP_POLICY.replace(
      'http:\n              - method: GET\n                path: /api',
      'http:\n              - method: GET\n                path: /api\n                headers:\n                  - "X-Foo: bar"',
    );
    const { policy } = detectAndParse(withHeaders);
    expect(policy.unsupported?.egress).toHaveLength(1);
    const yaml = generateCiliumYaml(policy);
    expect(yaml).toContain('X-Foo: bar');
  });

  it('k8s format is unaffected: l7 ports stay out of the K8s yaml', () => {
    const { policy } = detectAndParse(HTTP_POLICY);
    const yaml = generateK8sYaml(policy);
    // The K8s generator drops Cilium-only rules wholesale (they live on the
    // Cilium tab), so the L7 filter must never leak into this output. The
    // policy *name* legitimately contains "http", so assert on rule shape.
    expect(yaml).not.toMatch(/rules:|method:/);
  });
});
