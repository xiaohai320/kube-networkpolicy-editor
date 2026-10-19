/**
 * Thin client for the cluster proxy. Every request goes to the same-origin
 * `/k8s/*` path: in production the Hono backend owns it (in-cluster SA auth);
 * in dev the Vite middleware forwards it, with target + token riding on
 * `x-k8s-*` headers fed from sessionStorage (ADR-0001).
 */

const TARGET_HEADER = 'x-k8s-target';
const TOKEN_HEADER = 'x-k8s-token';
const STORAGE_KEY = 'netpol.cluster';

export interface DevCredentials {
  apiServer: string;
  token: string;
}

/** Dev-mode credentials live in sessionStorage only — never localStorage. */
export function loadDevCredentials(): DevCredentials | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<DevCredentials>;
    if (typeof parsed.apiServer === 'string' && typeof parsed.token === 'string') {
      return { apiServer: parsed.apiServer, token: parsed.token };
    }
  } catch {
    // Corrupted entry — treated as absent.
  }
  return undefined;
}

export function saveDevCredentials(creds: DevCredentials): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function clearDevCredentials(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Dev headers make sense only when the page is served by the Vite dev server.
 * In production the backend owns /k8s and the headers must not appear (they
 * would otherwise carry credentials to a same-origin endpoint — harmless but
 * noisy). Detection: vite serves with a `vite` marker in dev only.
 */
export function isDevMode(): boolean {
  return import.meta.env.DEV;
}

/** One entry of the cluster inventory list, before the full spec is fetched. */
export interface ClusterPolicyRef {
  kind: 'NetworkPolicy' | 'CiliumNetworkPolicy' | 'CiliumClusterwideNetworkPolicy';
  namespace: string;
  name: string;
  /** Resource version, for display only — apply is server-side. */
  resourceVersion?: string;
  /** Managed by Fleet/Helm — deletion may be silently undone by re-creation. */
  managed?: boolean;
}

export class ClusterApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClusterApiError';
  }
}

/** Fallback message when the body holds nothing usable. Node fetch leaves
 * statusText empty — spell out the code instead. */
function statusFallback(res: Response): string {
  return res.statusText || `HTTP ${res.status}`;
}

/** Read an error response once, deriving both reason and message. The body is
 * consumable only once, so everything shares this single read. */
async function parseStatus(res: Response): Promise<never> {
  let reason = 'Unknown';
  let message = statusFallback(res);
  try {
    const body = (await res.json()) as { reason?: string; message?: string };
    if (body.reason) reason = body.reason;
    if (body.message) message = body.message;
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  throw new ClusterApiError(res.status, reason, message);
}

function devHeaders(extra?: HeadersInit): HeadersInit {
  if (!isDevMode()) return extra ?? {};
  const creds = loadDevCredentials();
  const h = new Headers(extra);
  if (creds) {
    h.set(TARGET_HEADER, creds.apiServer);
    h.set(TOKEN_HEADER, creds.token);
  }
  return h;
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/k8s/${path}`, { ...init, headers: devHeaders(init?.headers) });
  if (!res.ok) await parseStatus(res);
  return res;
}

/** Fleet/Helm mark a policy managed via these label/annotation prefixes;
 * deleting a managed policy tends to be silently undone by re-creation.
 * Helm 3 stamps `meta.helm.sh/release-*` annotations and the
 * `app.kubernetes.io/managed-by: Helm` label (not `helm.sh/*` — that
 * prefix only appears on hook resources). */
const MANAGED_PREFIXES = ['fleet.cattle.io/', 'helm.sh/', 'meta.helm.sh/'];
const MANAGED_LABEL_VALUES: Array<{ key: string; value: string }> = [
  { key: 'app.kubernetes.io/managed-by', value: 'Helm' },
];

export function isManagedPolicy(item: Record<string, unknown>): boolean {
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const bags = [meta.labels, meta.annotations].map(b => (b ?? {}) as Record<string, string>);
  for (const bag of bags) {
    for (const key of Object.keys(bag)) {
      if (MANAGED_PREFIXES.some(p => key.startsWith(p))) return true;
    }
  }
  const labels = (meta.labels ?? {}) as Record<string, string>;
  return MANAGED_LABEL_VALUES.some(m => labels[m.key] === m.value);
}

/** List every network policy in the cluster, both kinds, minimal fields. */
export async function listClusterPolicies(): Promise<ClusterPolicyRef[]> {
  const [np, cnp] = await Promise.all([
    request('apis/networking.k8s.io/v1/networkpolicies').then(r => r.json()),
    request('apis/cilium.io/v2/ciliumnetworkpolicies').then(r => r.json()),
  ]);
  const refs: ClusterPolicyRef[] = [];
  for (const item of ((np as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>) {
    const meta = (item.metadata ?? {}) as Record<string, string>;
    refs.push({
      kind: 'NetworkPolicy',
      namespace: meta.namespace ?? '',
      name: meta.name ?? '',
      managed: isManagedPolicy(item) || undefined,
    });
  }
  for (const item of ((cnp as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>) {
    const meta = (item.metadata ?? {}) as Record<string, string>;
    refs.push({
      kind: 'CiliumNetworkPolicy',
      namespace: meta.namespace ?? '',
      name: meta.name ?? '',
      managed: isManagedPolicy(item) || undefined,
    });
  }
  return refs;
}

/** Fetch one policy's full manifest as YAML text (parsed by yaml-parser). */
export async function getClusterPolicyYaml(ref: ClusterPolicyRef): Promise<string> {
  const path = policyApiPath(ref);
  const res = await request(path);
  const manifest = await res.json();
  // Re-serialize to YAML so the existing detectAndParse path handles it.
  return yamlDump(manifest);
}

/** Namespaced resource path of a policy ref, in the apiserver's own spelling.
    CCNPs are cluster-scoped: no namespace segment. */
function policyApiPath(ref: Pick<ClusterPolicyRef, 'kind' | 'namespace' | 'name'>): string {
  switch (ref.kind) {
    case 'NetworkPolicy':
      return `apis/networking.k8s.io/v1/namespaces/${ref.namespace}/networkpolicies/${ref.name}`;
    case 'CiliumClusterwideNetworkPolicy':
      return `apis/cilium.io/v2/ciliumclusterwidenetworkpolicies/${ref.name}`;
    default:
      return `apis/cilium.io/v2/namespaces/${ref.namespace}/ciliumnetworkpolicies/${ref.name}`;
  }
}

async function yamlDump(manifest: unknown): Promise<string> {
  const { dump } = await import('js-yaml');
  return dump(manifest, { noRefs: true, lineWidth: -1, quotingType: '"', forceQuotes: true });
}

/** One workload's template labels, grouped by owning namespace. */
export interface WorkloadLabels {
  namespace: string;
  /** Deployment / StatefulSet / DaemonSet name. */
  workload: string;
  /** `spec.template.metadata.labels`, i.e. the labels the created pods carry. */
  labels: Record<string, string>;
}

/**
 * Template labels of the pod-creating controllers, used by the label pickers
 * so authors can select `k=v` pairs instead of typing them by hand. Lazy-loaded
 * once per open of the picker, the same way the policy inventory is.
 */
export async function listWorkloadLabels(): Promise<WorkloadLabels[]> {
  const apis = [
    'apis/apps/v1/deployments',
    'apis/apps/v1/statefulsets',
    'apis/apps/v1/daemonsets',
  ];
  const lists = await Promise.all(apis.map(api =>
    request(api).then(r => r.json()).catch(() => ({ items: [] })),
  ));
  const out: WorkloadLabels[] = [];
  for (const list of lists) {
    for (const item of ((list as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>) {
      const meta = (item.metadata ?? {}) as Record<string, string>;
      const template = (item.spec ?? {}) as { template?: { metadata?: { labels?: Record<string, string> } } };
      const labels = template.template?.metadata?.labels;
      if (labels && Object.keys(labels).length > 0) {
        out.push({ namespace: meta.namespace ?? '', workload: meta.name ?? '', labels });
      }
    }
  }
  return out;
}

/**
 * Server-side apply of the policy's manifest. `manifestYaml` is the YAML text
 * as generated from the model; a multi-document stream (K8s policies with
 * several selector groups are generated as `name-1`, `name-2`, … resources)
 * is split and applied document by document, since one PATCH targets exactly
 * one named resource.
 */
export async function applyClusterPolicy(
  ref: Pick<ClusterPolicyRef, 'kind' | 'namespace' | 'name'>,
  manifestYaml: string,
  /** `force` takes ownership of fields another controller manages — an
   * explicit user action after a 409, never the default. */
  opts: { force?: boolean } = {},
): Promise<void> {
  const { loadAll } = await import('js-yaml');
  const docs = (loadAll as (s: string) => unknown[])(manifestYaml).filter(
    d => d !== null && typeof d === 'object',
  ) as Array<Record<string, unknown>>;
  for (const doc of docs) {
    const meta = (doc.metadata ?? {}) as Record<string, string>;
    const kind = doc.kind === 'CiliumNetworkPolicy' ? 'CiliumNetworkPolicy' : 'NetworkPolicy';
    const namespace = meta.namespace ?? ref.namespace;
    const name = meta.name ?? ref.name;
    await applyOne({ kind, namespace, name }, await yamlDump(doc), opts.force ?? false);
  }
}

/** SSA of a single YAML document to its own named resource. */
async function applyOne(
  ref: Pick<ClusterPolicyRef, 'kind' | 'namespace' | 'name'>,
  docYaml: string,
  force: boolean,
): Promise<void> {
  const res = await fetch(`/k8s/${resourcePath(ref)}?fieldManager=netpol-editor&force=${force}`, {
    method: 'PATCH',
    headers: devHeaders({ 'content-type': 'application/apply-patch+yaml' }),
    body: docYaml,
  });
  if (!res.ok) await parseStatus(res);
}

/** Namespaced resource path of a policy ref, in the apiserver's own spelling. */
function resourcePath(ref: Pick<ClusterPolicyRef, 'kind' | 'namespace' | 'name'>): string {
  return ref.kind === 'NetworkPolicy'
    ? `apis/networking.k8s.io/v1/namespaces/${ref.namespace}/networkpolicies/${ref.name}`
    : `apis/cilium.io/v2/namespaces/${ref.namespace}/ciliumnetworkpolicies/${ref.name}`;
}

/** Outcome of a best-effort batch delete. */
export interface DeleteReport {
  deleted: number;
  failed: Array<{ ref: ClusterPolicyRef; message: string }>;
}

/**
 * Delete each ref, sequentially and best-effort: 404 counts as deleted
 * (already gone), any other failure is captured into the report and the
 * remaining deletes still run.
 */
export async function deleteClusterPolicies(refs: ClusterPolicyRef[]): Promise<DeleteReport> {
  const report: DeleteReport = { deleted: 0, failed: [] };
  for (const ref of refs) {
    const res = await fetch(`/k8s/${resourcePath(ref)}`, {
      method: 'DELETE',
      headers: devHeaders(),
    }).catch(() => undefined);
    if (!res) {
      report.failed.push({ ref, message: 'network error' });
      continue;
    }
    if (res.ok || res.status === 404) {
      report.deleted += 1;
      continue;
    }
    // Same single-read error extraction as every other failure path.
    let message = statusFallback(res);
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Non-JSON body — keep the fallback.
    }
    report.failed.push({ ref, message });
  }
  return report;
}
