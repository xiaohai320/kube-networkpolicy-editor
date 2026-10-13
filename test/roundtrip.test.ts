import { beforeAll, describe, expect, it } from 'vitest';
import type { Policy } from '@/types/policy';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { detectAndParse } from '@/lib/yaml-parser';
import { ALL_NAMESPACES } from '@/lib/label-utils';
import {
  ep,
  policy,
  PORT_DNS_TCP,
  PORT_DNS_UDP,
  PORT_HTTP,
  PORT_HTTPS,
  resetIds,
  withoutIds,
} from './helpers';

beforeAll(resetIds);

/**
 * `parse(generate(p)) === p`, ignoring ids. This is the property that makes the
 * YAML panel a live sync rather than a one-way export: every case below must
 * survive a round trip, or the parser and the generator disagree about the
 * model and the canvas drifts from the text the user is reading.
 *
 * Only cases each format can express are listed. Kubernetes cannot distinguish
 * `all`/outside from a `0.0.0.0/0` CIDR, and it approximates `kube-dns` with a
 * label selector, so those are deliberately absent.
 */
const ciliumCases: Array<[string, Policy]> = [
  [
    'outside CIDR with a port',
    policy({ format: 'cilium' }, {
      ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] })],
    }),
  ],
  [
    'CIDR with exclusions',
    policy({ format: 'cilium' }, {
      egress: [ep('cidr', 'outside', { cidr: '0.0.0.0/0', except: ['10.0.0.0/8'] })],
    }),
  ],
  ['the world entity', policy({ format: 'cilium' }, { ingress: [ep('all', 'outside')] })],
  ['the cluster entity', policy({ format: 'cilium' }, { egress: [ep('all', 'cluster')] })],
  ['every pod in the namespace', policy({ format: 'cilium' }, { ingress: [ep('all', 'namespace')] })],
  ['the host entity', policy({ format: 'cilium' }, { egress: [ep('entity', 'cluster', { entity: 'host' })] })],
  ['kube-dns with the standard ports', policy({ format: 'cilium' }, {
    egress: [ep('kube-dns', 'cluster', { ports: [PORT_DNS_UDP, PORT_DNS_TCP] })],
  })],
  ['an FQDN with matchName and matchPattern', policy({ format: 'cilium' }, {
    egress: [ep('fqdn', 'outside', { matchName: 'api.example.com', matchPattern: '*.internal' })],
  })],
  ['a cross-namespace labels peer', policy({ format: 'cilium' }, {
    ingress: [ep('labels', 'cluster', { namespace: 'payments', podSelector: { app: 'api' }, ports: [PORT_HTTPS] })],
  })],
  ['a namespace-local labels peer', policy({ format: 'cilium' }, {
    ingress: [ep('labels', 'namespace', { podSelector: { app: 'api' } })],
  })],
  ['pod labels with matchExpressions', policy({ format: 'cilium' }, {
    egress: [
      ep('labels', 'namespace', {
        podSelector: { app: 'worker' },
        podExpressions: [{ key: 'tier', operator: 'In', values: ['back'] }],
      }),
    ],
  })],
  ['namespace label selectors', policy({ format: 'cilium' }, {
    ingress: [
      ep('labels', 'cluster', {
        namespaceSelector: { 'kubernetes.io/metrics': 'enabled' },
        podSelector: { app: 'api' },
      }),
    ],
  })],
  ['all namespaces via the Exists expression', policy({ format: 'cilium' }, {
    ingress: [ep('labels', 'cluster', { namespace: ALL_NAMESPACES, podSelector: { app: 'api' } })],
  })],
  ['a named service', policy({ format: 'cilium' }, {
    egress: [ep('service', 'namespace', { namespace: 'kube-system', serviceName: 'dns' })],
  })],
  ['a policy-level selector with expressions', policy({ format: 'cilium' }, {
    endpointSelector: {
      matchLabels: { app: 'web' },
      matchExpressions: [{ key: 'tier', operator: 'In', values: ['front'] }],
    },
    ingress: [ep('all', 'outside')],
  })],
  ['explicit default-deny on one direction', policy({ format: 'cilium' }, {
    defaultDenyEgress: true,
    ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTPS] })],
  })],
  ['rules in both directions', policy({ format: 'cilium' }, {
    endpointSelector: { matchLabels: { app: 'frontend' } },
    ingress: [ep('labels', 'namespace', { podSelector: { app: 'user' }, ports: [PORT_HTTP] })],
    egress: [ep('kube-dns', 'cluster', { ports: [PORT_DNS_UDP] })],
  })],
];

const k8sCases: Array<[string, Policy]> = [
  [
    'outside CIDR with a port',
    policy({ format: 'k8s' }, {
      ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTP] })],
    }),
  ],
  [
    'CIDR with exclusions',
    policy({ format: 'k8s' }, {
      egress: [ep('cidr', 'outside', { cidr: '0.0.0.0/0', except: ['10.0.0.0/8'] })],
    }),
  ],
  ['all pods in the namespace', policy({ format: 'k8s' }, { ingress: [ep('all', 'namespace')] })],
  ['every pod in the cluster', policy({ format: 'k8s' }, { egress: [ep('all', 'cluster')] })],
  ['pod labels with matchExpressions', policy({ format: 'k8s' }, {
    ingress: [
      ep('labels', 'namespace', {
        podSelector: { app: 'worker' },
        podExpressions: [{ key: 'tier', operator: 'In', values: ['back'] }],
      }),
    ],
  })],
  [
    'a cross-namespace labels peer',
    policy({ format: 'k8s' }, {
      egress: [
        ep('labels', 'cluster', {
          namespace: 'payments',
          podSelector: { app: 'api' },
          podExpressions: [{ key: 'tier', operator: 'In', values: ['back'] }],
          ports: [PORT_HTTPS],
        }),
      ],
    }),
  ],
  ['namespace label selectors', policy({ format: 'k8s' }, {
    egress: [
      ep('labels', 'cluster', {
        namespaceSelector: { 'kubernetes.io/metrics': 'enabled' },
        podSelector: { app: 'api' },
      }),
    ],
  })],
  ['a policy-level selector with expressions', policy({ format: 'k8s' }, {
    endpointSelector: {
      matchLabels: { app: 'web' },
      matchExpressions: [{ key: 'tier', operator: 'In', values: ['front'] }],
    },
    ingress: [ep('all', 'namespace')],
  })],
  [
    'explicit default-deny, no rules',
    policy({ format: 'k8s' }, { defaultDenyIngress: true, defaultDenyEgress: true }),
  ],
  ['default-deny alongside rules', policy({ format: 'k8s' }, {
    defaultDenyEgress: true,
    ingress: [ep('cidr', 'outside', { cidr: '10.0.0.0/8', ports: [PORT_HTTPS] })],
  })],
];

for (const [name, authored] of [...ciliumCases, ...k8sCases]) {
  const format = authored.format;
  const label = format === 'cilium' ? 'Cilium' : 'Kubernetes';

  it(`round-trips (${label}): ${name}`, () => {
    const text = format === 'cilium' ? generateCiliumYaml(authored) : generateK8sYaml(authored);
    const parsed = detectAndParse(text).policy;
    expect(withoutIds(parsed), text).toEqual(withoutIds(authored));
  });
}

describe('generate then generate is a no-op', () => {
  for (const [name, authored] of [...ciliumCases, ...k8sCases]) {
    it(`is idempotent: ${name}`, () => {
      const text = authored.format === 'cilium' ? generateCiliumYaml(authored) : generateK8sYaml(authored);
      const parsed = detectAndParse(text).policy;
      const again = parsed.format === 'cilium' ? generateCiliumYaml(parsed) : generateK8sYaml(parsed);
      expect(again).toBe(text);
    });
  }
});
