import type { Endpoint, LabelSelector } from '@/types/policy';
import type { MessageParam, Msg } from '@/i18n';
import { ALL_NAMESPACES, formatLabels } from './label-utils';

/**
 * One-line descriptions of a peer. The canvas calls these for both columns, so
 * they live here rather than being copy-pasted into IngressColumn and
 * EgressColumn. Warnings use them too.
 *
 * Prose is returned as an i18n key; anything that is a YAML identifier — a
 * CIDR, a hostname, an entity, a label set — is interpolated as-is.
 */

/** The peer itself, without its ports. */
export function endpointSummary(endpoint: Endpoint): Msg {
  switch (endpoint.kind) {
    case 'all':
      return endpoint.group === 'outside'
        ? { key: 'endpoint-any-endpoint' }
        : endpoint.group === 'cluster'
          ? { key: 'endpoint-all-cluster' }
          : { key: 'endpoint-any-pod' };
    case 'cidr':
      return endpoint.cidr
        ? { key: 'endpoint-cidr', params: { value: endpoint.cidr } }
        : { key: 'field-cidr' };
    case 'fqdn': {
      const value = endpoint.matchName ?? endpoint.matchPattern;
      return value
        ? { key: 'endpoint-fqdn', params: { value } }
        : { key: 'endpoint-fqdn-label' };
    }
    case 'entity':
      return { key: 'endpoint-entity', params: { value: endpoint.entity } };
    case 'kube-dns':
      return { key: 'endpoint-kube-dns' };
    case 'service':
      if (!endpoint.serviceName) {
        const labels = formatLabels(endpoint.selector);
        return labels ? { key: 'endpoint-labels', params: { body: labels } } : { key: 'endpoint-service' };
      }
      return {
        key: 'endpoint-service-names',
        params: { namespace: endpoint.namespace ?? '?', name: endpoint.serviceName },
      };
    case 'labels': {
      const pod = formatLabels(endpoint.podSelector);
      const ns = formatLabels(endpoint.namespaceSelector);
      const body: MessageParam =
        pod || ns || (endpoint.podExpressions?.length ? { key: 'endpoint-expression' } : '');
      if (typeof body === 'string' && body === '') {
        return {
          key: endpoint.namespace === ALL_NAMESPACES ? 'endpoint-any-pod-all-namespaces' : 'endpoint-any-pod',
        };
      }
      return endpoint.namespace
        ? { key: 'endpoint-labels-ns', params: { namespace: endpoint.namespace, body } }
        : { key: 'endpoint-labels', params: { body } };
    }
  }
}

/** Port list for a card row: `:80, :443`. Empty when all ports are allowed. */
export function portSummary(endpoint: Endpoint): string {
  if (endpoint.ports.length === 0) return '';
  return endpoint.ports
    .map(p => `:${p.port}/${p.protocol}`)
    .join(', ');
}

/** Summary of the target pod selector shown on the center node. */
export function selectorSummary(selector: LabelSelector | undefined): Msg {
  if (!selector) return { key: 'endpoint-all-pods' };
  const labels = formatLabels(selector.matchLabels);
  const exprs = (selector.matchExpressions ?? []).map(e => `${e.key} ${e.operator}`);
  const body = [labels, ...exprs].filter(Boolean).join(', ');
  return body ? { key: 'endpoint-labels', params: { body } } : { key: 'endpoint-all-pods' };
}
