import type { ReactNode } from 'react';
import { Braces, Crosshair, Globe, Network, Server, Shield, ShieldCheck, Wifi } from 'lucide-react';
import type { Direction, Endpoint, RuleGroup } from '@/types/policy';
import { newEndpoint } from '@/types/policy';
import { KUBE_DNS } from '@/lib/label-utils';
import type { TFunc } from '@/i18n';

/** One entry in the rule-type picker: a translated label plus a template peer. */
export interface SubTypeOption {
  label: string;
  description: string;
  icon: ReactNode;
  endpoint: Endpoint;
  /** Greyed out and unclickable — the kube-dns shortcut after it has been used. */
  disabled?: boolean;
  /** Shown next to the label instead of the description when disabled. */
  disabledLabel?: string;
}

/** Column header labels, per group. Keys only: the caller translates. */
export const GROUP_TITLES: Record<RuleGroup, { icon: typeof Globe; key: string }> = {
  outside: { icon: Globe, key: 'group-outside' },
  namespace: { icon: Braces, key: 'group-namespace' },
  cluster: { icon: Network, key: 'group-cluster' },
};

/**
 * One line under each group title, stating what the group reaches. The
 * `namespace` line is what makes the column's semantics obvious — it is the
 * policy's own namespace, so there is no namespace to pick inside it.
 */
export const GROUP_SUBTITLES: Record<RuleGroup, string> = {
  outside: 'group-outside-desc',
  namespace: 'group-namespace-desc',
  cluster: 'group-cluster-desc',
};

/**
 * What each column offers to add. Templates are built per call because their
 * labels are translated; `cloneEndpoint` copies them at add time, so repeated
 * adds never share ids.
 */
export function pickersFor(
  t: TFunc,
  direction: Direction,
  group: RuleGroup,
  hasKubeDns = false,
): SubTypeOption[] {
  const outside: SubTypeOption[] = [
    {
      label: t('picker-all-outside'),
      description: t('picker-ports-any'),
      icon: <Server size={14} />,
      endpoint: newEndpoint('all', 'outside'),
    },
    {
      label: t('picker-cidr'),
      description: t('picker-cidr-example'),
      icon: <Crosshair size={14} />,
      endpoint: newEndpoint('cidr', 'outside', { cidr: '' }),
    },
  ];

  if (direction === 'egress') {
    outside.push({
      label: t('picker-fqdn'),
      description: t('picker-fqdn-example'),
      icon: <Wifi size={14} />,
      endpoint: newEndpoint('fqdn', 'outside', { matchPattern: '' }),
    });
  }

  const namespace: SubTypeOption[] = [
    {
      label: t('picker-any-pod'),
      description: t('picker-ports-any'),
      icon: <Server size={14} />,
      endpoint: newEndpoint('all', 'namespace'),
    },
    {
      label: t('picker-pod-selector'),
      description: t('picker-selector-example'),
      icon: <Crosshair size={14} />,
      endpoint: newEndpoint('labels', 'namespace', { podSelector: {} }),
    },
  ];

  const cluster: SubTypeOption[] = [
    {
      label: t('picker-all-cluster'),
      description: t('picker-ports-any'),
      icon: <Network size={14} />,
      endpoint: newEndpoint('all', 'cluster'),
    },
    {
      label: t('picker-pod-selector'),
      description: t('picker-selector-example'),
      icon: <Crosshair size={14} />,
      endpoint: newEndpoint('labels', 'cluster', { podSelector: {} }),
    },
  ];

  if (direction === 'egress') {
    cluster.push(
      {
        label: t('picker-host'),
        description: t('picker-entity-host'),
        icon: <Shield size={14} />,
        endpoint: newEndpoint('entity', 'cluster', { entity: 'host' }),
      },
      {
        label: t('picker-remote-node'),
        description: t('picker-entity-remote-node'),
        icon: <ShieldCheck size={14} />,
        endpoint: newEndpoint('entity', 'cluster', { entity: 'remote-node' }),
      },
      {
        label: t('picker-kube-dns'),
        description: t('picker-kube-dns-ports', { port: KUBE_DNS.port, protocol: KUBE_DNS.protocol }),
        icon: <Braces size={14} />,
        endpoint: newEndpoint('kube-dns', 'cluster', {
          ports: [
            { port: KUBE_DNS.port, protocol: KUBE_DNS.protocol },
            { port: KUBE_DNS.port, protocol: 'TCP' },
          ],
        }),
        disabled: hasKubeDns,
        disabledLabel: t('picker-added'),
      },
    );
  }

  switch (group) {
    case 'outside':
      return outside;
    case 'namespace':
      return namespace;
    case 'cluster':
      return cluster;
  }
}
