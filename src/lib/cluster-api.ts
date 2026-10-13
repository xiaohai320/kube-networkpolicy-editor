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
  kind: 'NetworkPolicy' | 'CiliumNetworkPolicy';
  namespace: string;
  name: string;
  /** Resource version, for display only — apply is server-side. */
  resourceVersion?: string;
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

async function parseStatus(res: Response): Promise<never> {
  let reason = 'Unknown';
  let message = res.statusText;
  try {
    const body = (await res.json()) as { reason?: string; message?: string };
    reason = body.reason ?? reason;
    message = body.message ?? message;
  } catch {
    // Non-JSON error body — keep statusText.
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

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/k8s/${path}`, { ...init, headers: devHeaders(init?.headers) });
  if (!res.ok) await parseStatus(res);
  return res;
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
    refs.push({ kind: 'NetworkPolicy', namespace: meta.namespace ?? '', name: meta.name ?? '' });
  }
  for (const item of ((cnp as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>) {
    const meta = (item.metadata ?? {}) as Record<string, string>;
    refs.push({ kind: 'CiliumNetworkPolicy', namespace: meta.namespace ?? '', name: meta.name ?? '' });
  }
  return refs;
}

/** Fetch one policy's full manifest as YAML text (parsed by yaml-parser). */
export async function getClusterPolicyYaml(ref: ClusterPolicyRef): Promise<string> {
  const path =
    ref.kind === 'NetworkPolicy'
      ? `apis/networking.k8s.io/v1/namespaces/${ref.namespace}/networkpolicies/${ref.name}`
      : `apis/cilium.io/v2/namespaces/${ref.namespace}/ciliumnetworkpolicies/${ref.name}`;
  const res = await request(path);
  const manifest = await res.json();
  // Re-serialize to YAML so the existing detectAndParse path handles it.
  return yamlDump(manifest);
}

async function yamlDump(manifest: unknown): Promise<string> {
  const { dump } = await import('js-yaml');
  return dump(manifest, { noRefs: true, lineWidth: -1, quotingType: '"', forceQuotes: true });
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
    await applyOne({ kind, namespace, name }, await yamlDump(doc));
  }
}

/** SSA of a single YAML document to its own named resource. */
async function applyOne(
  ref: Pick<ClusterPolicyRef, 'kind' | 'namespace' | 'name'>,
  docYaml: string,
): Promise<void> {
  const path =
    ref.kind === 'NetworkPolicy'
      ? `apis/networking.k8s.io/v1/namespaces/${ref.namespace}/networkpolicies/${ref.name}`
      : `apis/cilium.io/v2/namespaces/${ref.namespace}/ciliumnetworkpolicies/${ref.name}`;
  const res = await fetch(`/k8s/${path}?fieldManager=netpol-editor&force=false`, {
    method: 'PATCH',
    headers: devHeaders({ 'content-type': 'application/apply-patch+yaml' }),
    body: docYaml,
  });
  if (!res.ok) await parseStatus(res);
}
