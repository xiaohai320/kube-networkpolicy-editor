import type { LabelSelector, MatchExpression } from '@/types/policy';

/**
 * Cilium and Kubernetes address the same pod and namespace labels with
 * different prefixes. Cilium needs the label source spelled out because its
 * endpoint labels mix pod labels, namespace labels and its own; Kubernetes
 * namespaces them by field instead. These helpers are the only place the two
 * spellings are bridged, so neither generator has to remember them.
 */

/** Cilium label source prefix for Kubernetes pod labels. */
export const K8S_PREFIX = 'k8s:';
/** Cilium label carrying a pod's namespace name. */
export const NAMESPACE_LABEL = 'io.kubernetes.pod.namespace';
/** Cilium label prefix for a namespace's own labels. */
export const NAMESPACE_LABELS_PREFIX = 'io.kubernetes.pod.namespace.labels.';
/** Kubernetes metadata name of a namespace. */
export const NAMESPACE_NAME_LABEL = 'kubernetes.io/metadata.name';

/** Marker meaning "every namespace" in a labels endpoint. */
export const ALL_NAMESPACES = '*';

/** Labels identifying the kube-dns pods. */
export const KUBE_DNS = {
  namespace: 'kube-system',
  labelKey: 'k8s-app',
  labelValue: 'kube-dns',
  port: 53,
  protocol: 'UDP',
} as const;

/** Cilium entities serialised bare into `toEntities` / `fromEntities`. */
export const ENTITY_ENTITY: Record<
  'all' | 'world' | 'cluster' | 'host' | 'remote-node' | 'kube-dns',
  string
> = {
  all: 'all',
  world: 'world',
  cluster: 'cluster',
  host: 'host',
  'remote-node': 'remote-node',
  'kube-dns': 'kube-dns',
};

export function addLabel(out: Record<string, string>, key: string, value: string): Record<string, string> {
  if (value !== '') out[key] = value;
  return out;
}

/**
 * Convert a pod-label selector to Cilium endpoint labels.
 * `k8s:` is idempotent, so an already-prefixed key is left alone.
 */
export function toCiliumPodLabels(labels?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    addLabel(out, key.startsWith(K8S_PREFIX) ? key : `${K8S_PREFIX}${key}`, value);
  }
  return out;
}

/** Inverse of {@link toCiliumPodLabels}: strip the `k8s:` prefix. */
export function fromCiliumPodLabels(labels?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    addLabel(out, key.startsWith(K8S_PREFIX) ? key.slice(K8S_PREFIX.length) : key, value);
  }
  return out;
}

/** Prefix a label key for use in a Cilium `matchExpressions` entry. */
export function ciliumExpressionKey(key: string): string {
  return key.startsWith(K8S_PREFIX) ? key : `${K8S_PREFIX}${key}`;
}

/** Inverse of {@link ciliumExpressionKey}: strip the `k8s:` prefix. */
export function fromCiliumExpressionKey(key: string): string {
  return key.startsWith(K8S_PREFIX) ? key.slice(K8S_PREFIX.length) : key;
}

/**
 * Find an "all namespaces" selector expressed the Cilium way, i.e.
 * `{ key: io.kubernetes.pod.namespace, operator: Exists }`.
 */
export function findAllNamespacesExpression(expressions?: MatchExpression[]): boolean {
  return (expressions ?? []).some(
    e => e.key === NAMESPACE_LABEL && (e.operator === 'Exists' || e.operator === 'DoesNotExist'),
  );
}

/**
 * Split a Cilium endpoint label selector back into the model's separate pod and
 * namespace parts. Anything Cilium-specific that we do not model is dropped
 * here rather than silently passed through as a pod label.
 */
export function splitCiliumLabels(
  matchLabels?: Record<string, string>,
): { namespace?: string; podSelector: Record<string, string>; namespaceSelector: Record<string, string> } {
  const podSelector: Record<string, string> = {};
  const namespaceSelector: Record<string, string> = {};
  let namespace: string | undefined;

  for (const [key, value] of Object.entries(matchLabels ?? {})) {
    if (key === NAMESPACE_LABEL) {
      namespace = value;
    } else if (key.startsWith(NAMESPACE_LABELS_PREFIX)) {
      addLabel(namespaceSelector, key.slice(NAMESPACE_LABELS_PREFIX.length), value);
    } else {
      addLabel(podSelector, key.startsWith(K8S_PREFIX) ? key.slice(K8S_PREFIX.length) : key, value);
    }
  }
  return { namespace, podSelector, namespaceSelector };
}

/**
 * Strip Cilium's namespace label prefix down to the bare namespace name, so the
 * model holds `namespace: "payments"` rather than the raw label form.
 */
export function namespaceFromLabels(matchLabels?: Record<string, string>): string | undefined {
  for (const [key, value] of Object.entries(matchLabels ?? {})) {
    if (key === NAMESPACE_LABEL) return value;
    const prefixed = `${K8S_PREFIX}${NAMESPACE_LABEL}`;
    if (key === prefixed) return value;
  }
  return undefined;
}

/**
 * Merge two label selectors. Labels are merged key by key; expressions are
 * concatenated. Later values win on key conflict.
 */
export function mergeLabelSelectors(a?: LabelSelector, b?: LabelSelector): LabelSelector {
  const matchLabels: Record<string, string> = {};
  for (const sel of [a, b]) {
    for (const [k, v] of Object.entries(sel?.matchLabels ?? {})) matchLabels[k] = v;
  }
  const matchExpressions = [...(a?.matchExpressions ?? []), ...(b?.matchExpressions ?? [])];
  return {
    matchLabels: Object.keys(matchLabels).length > 0 ? matchLabels : undefined,
    matchExpressions: matchExpressions.length > 0 ? matchExpressions : undefined,
  };
}

/** True when a label selector selects everything. */
export function isEmptySelector(sel?: LabelSelector): boolean {
  return !sel || (Object.keys(sel.matchLabels ?? {}).length === 0 && (sel.matchExpressions ?? []).length === 0);
}

/** Stable, order-insensitive rendering used for summaries and fingerprints. */
export function formatLabels(labels?: Record<string, string>): string {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return '';
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/** Stable, order-insensitive fingerprint of a label selector. */
export function selectorFingerprint(sel?: LabelSelector): string {
  const labels = formatLabels(sel?.matchLabels);
  const exprs = (sel?.matchExpressions ?? [])
    .map(e => `${e.key}:${e.operator}:${[...e.values].sort().join(',')}`)
    .sort()
    .join(',');
  return `labels[${labels}]expr[${exprs}]`;
}
