import { beforeAll, describe, expect, it } from 'vitest';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { ep, policy, PORT_HTTP, resetIds } from './helpers';

beforeAll(resetIds);

// Proves vitest + esbuild + the `@` alias + TS resolve in this environment.
describe('toolchain', () => {
  it('generates Kubernetes YAML', () => {
    const p = policy(
      { name: 'probe', namespace: 'default', format: 'k8s' },
      { ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] })] },
    );
    const yaml = generateK8sYaml(p);
    expect(yaml).toContain('apiVersion: "networking.k8s.io/v1"');
    expect(yaml).toContain('cidr: "10.0.0.0/8"');
  });

  it('generates Cilium YAML', () => {
    const p = policy(
      { name: 'probe', namespace: 'default', format: 'cilium' },
      { ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8' })] },
    );
    expect(generateCiliumYaml(p)).toContain('apiVersion: "cilium.io/v2"');
  });
});
