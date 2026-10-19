import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, X, Loader2, ShieldOff } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopologyCanvas } from './TopologyCanvas';
import {
  buildTopologyGraph,
  policiesForNamespace,
  selectorMatches,
  workloadNodeId,
  type EngineSpec,
  type PolicyRef,
  type PodInfo,
} from './topology-engine';
import { fetchTopologyData, fetchNamespaceLabels, listAllNamespaces } from './topology-data';
import { getClusterPolicyYaml, listClusterPolicies, ClusterApiError } from '@/lib/cluster-api';
import { useTranslation } from '@/i18n';
import { useEscape } from '@/hooks/useEscape';
import { BTN_SECONDARY, BTN_PRIMARY, BTN_TOOLBAR } from '@/components/ui/button';

/**
 * The topology dashboard (拓扑看板): a full-screen read-only overlay. Pick a
 * namespace, and the board derives who-can-talk-to-whom from the namespace's
 * actual pods plus every NP/CNP/CCNP. Read-only by design — fixing a policy
 * happens in the editor via the drawer's load action.
 */

export interface TopologyDashboardProps {
  onClose: () => void;
  /** Load a policy into the editor as a new page (the ClusterPanel's action). */
  onLoadPolicy: (yaml: string, label: string) => void;
  /** Guided empty state's CTA: close the board and open a fresh editor page. */
  onStartAuthoring: () => void;
}

/** Engine input as fetched, kept for the details drawer's provenance join. */
interface LoadedData {
  pods: PodInfo[];
  policies: PolicyRef[];
  namespaceLabels: Record<string, string>;
}

/** What the drawer can show: a node's policies or an edge's policies. */
interface DrawerState {
  title: string;
  policies: Array<{
    ref: PolicyRef;
    rules: string[];
  }>;
  /** For a node drawer: which policy objects select the workload. */
  nodeRefs?: PolicyRef[];
}

export function TopologyDashboard({ onClose, onLoadPolicy, onStartAuthoring }: TopologyDashboardProps) {
  const { t } = useTranslation();
  useEscape(onClose);

  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  // Namespace inventory: the cluster panel's policy list is the cheapest
  // source (already RBAC'd, no namespace object needed). Policy-bearing
  // namespaces sort first (spec story 1). The full namespace list rides
  // behind them so a zero-policy cluster (the spec's "first impression"
  // state) still has an entry point — and so the empty state is reachable.
  useEffect(() => {
    let live = true;
    Promise.all([listClusterPolicies().catch(() => []), listAllNamespaces()]).then(
      ([refs, allNamespaces]) => {
      if (!live) return;
      const withPolicies = [...new Set(refs.map(r => r.namespace))].sort();
      const rest = allNamespaces.filter(ns => !withPolicies.includes(ns));
        setNamespaces([...withPolicies, ...rest]);
        // Default to the first policy-bearing namespace, else the first ns.
        setSelected(withPolicies[0] ?? allNamespaces[0] ?? '');
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async (ns: string) => {
    if (!ns) return;
    // Staleness guard: only the newest invocation may write state. Selecting
    // B while A's fetch is still in flight would otherwise land A's pods and
    // policies under B's dropdown — every node wrong, no error shown.
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    setDrawer(null);
    try {
      const [fetched, npList] = await Promise.all([
        fetchTopologyData(ns),
        // Namespace labels for CCNP namespaceSelector scoping (best-effort).
        fetchNamespaceLabels(ns),
      ]);
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      // Policy-bearing namespaces may hold CCNPs only — fetchTopologyData
      // already returns those, so an empty pod list is still a valid board.
      setData({ pods: fetched.pods, policies: fetched.policies, namespaceLabels: npList });
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setError(err instanceof ClusterApiError ? err.message : String(err));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selected);
  }, [selected, load]);

  const graph = useMemo(() => {
    if (!data) return null;
    return buildTopologyGraph(selected, data.pods, data.policies, data.namespaceLabels);
  }, [data, selected]);

  const handleNodeClick = useCallback(
    (id: string) => {
      if (!data || !graph) return;
      if (id.startsWith('edge:')) {
        // Edge drawer: the provenance already carries exactly the policies
        // that allow the path, with their port summaries.
        const edge = graph.edges.find(e => e.id === id);
        if (!edge) return;
        const node = graph.nodes.find(n => n.id === edge.source);
        const target = graph.nodes.find(n => n.id === edge.target);
        setDrawer({
          title: `${node?.label ?? edge.source} → ${target?.label ?? edge.target}`,
          policies: edge.policies.map(p => ({
            ref: { kind: p.kind, namespace: p.namespace, name: p.name, format: p.kind === 'NetworkPolicy' ? 'k8s' : 'cilium', specs: [] },
            rules: p.rules,
          })),
        });
        return;
      }
      // Node drawer: every policy that selects the workload (spec story 9).
      const node = graph.nodes.find(n => n.id === id);
      if (!node || node.type !== 'workload') return;
      // The drawer must agree with the board: a policy counts when ANY pod of
      // the node matches the spec's endpointSelector — the same ANY-pod rule
      // the engine uses for edges and badges — plus, for CCNPs, the spec's
      // namespace scope matching this namespace's labels.
      const labelsList = data.pods
        .filter(p => workloadNodeId(p.workload ?? p.name) === id)
        .map(p => p.labels);
      const nodeRefs = policiesForNamespace(data.policies, selected, data.namespaceLabels)
        .filter(p => p.specs.some(s => specAppliesToNode(s, labelsList)));
      if (nodeRefs.length === 0) {
        setDrawer({ title: node.label, policies: [], nodeRefs: [] });
        return;
      }
      setDrawer({ title: node.label, policies: [], nodeRefs });
    },
    [data, graph],
  );

  const handleJumpNamespace = useCallback((ns: string) => {
    if (!ns) return;
    // Namespace nodes may reference a ns the inventory lacks (a policy
    // outside the inventory's snapshot) — add it so the dropdown keeps up.
    setNamespaces(list => (list.includes(ns) ? list : [...list, ns].sort()));
    setSelected(ns);
  }, []);

  const loadIntoEditor = useCallback(
    async (ref: PolicyRef) => {
      // CCNPs carry no namespace — their fetch path is cluster-scoped
      // (policyApiPath branches); the editor parses the manifest either way.
      try {
        const yaml = await getClusterPolicyYaml({
          kind: ref.kind,
          namespace: ref.namespace || selected,
          name: ref.name,
        });
        onLoadPolicy(yaml, `${ref.namespace || selected}/${ref.name}`);
        // The new editor tab sits BEHIND this fullscreen overlay — close the
        // board so the jump is visible instead of happening silently.
        onClose();
      } catch {
        setError(String(t('topo-load-error')));
      }
    },
    [onLoadPolicy, selected, onClose, t],
  );

  const grouped = useMemo(() => {
    if (!drawer) return null;
    const groups = new Map<PolicyRef['kind'], DrawerState['policies']>();
    for (const p of drawer.policies) {
      const list = groups.get(p.ref.kind) ?? [];
      list.push(p);
      groups.set(p.ref.kind, list);
    }
    return groups;
  }, [drawer]);

  return createPortal(
    <div className="fixed inset-0 z-[900] flex flex-col bg-canvas" role="dialog" aria-modal="true" aria-label={t('topo-title')}>
      {/* Header: namespace dropdown + refresh, mirroring the cluster panel's controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-card-border bg-surface">
        <span className="text-sm font-semibold text-text-primary flex-1">{t('topo-title')}</span>
        <label className="text-xs text-text-secondary" htmlFor="topo-ns">{t('topo-namespace')}</label>
        <select
          id="topo-ns"
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="bg-input-bg border border-input-border rounded px-2 py-1 text-xs text-input-text max-w-[220px]"
        >
          {namespaces.length === 0 && <option value="">—</option>}
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
        <button className={BTN_TOOLBAR} onClick={() => void load(selected)} aria-label={t('topo-refresh')} title={t('topo-refresh')}>
          <RefreshCw size={14} />
        </button>
        <button className={BTN_TOOLBAR} onClick={onClose} aria-label={t('topo-close')} title={t('topo-close')}>
          <X size={14} />
        </button>
      </div>

      {/* Body: canvas, or loading / error / empty states */}
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-text-secondary text-sm">
            <Loader2 size={16} className="animate-spin" /> {t('topo-loading')}
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-arrow-deny">{error}</div>
        )}
        {!loading && !error && graph && (
          <ReactFlowProvider>
            <TopologyCanvas
              graph={graph}
              onJumpNamespace={handleJumpNamespace}
              onNodeClick={handleNodeClick}
            />
          </ReactFlowProvider>
        )}
        {!loading && !error && graph?.empty && (
          <div className="absolute inset-x-0 bottom-6 flex justify-center pointer-events-none">
            <div className="pointer-events-auto bg-card-bg border border-card-border rounded-xl shadow-pop px-5 py-4 max-w-md text-center">
              <ShieldOff size={20} className="mx-auto text-text-secondary mb-2" />
              <p className="text-sm font-semibold text-text-primary">{t('topo-empty-title')}</p>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">{t('topo-empty-body')}</p>
              <button className={`${BTN_PRIMARY} mt-3`} onClick={onStartAuthoring}>
                {t('topo-empty-cta')}
              </button>
            </div>
          </div>
        )}
        {/* Details drawer */}
        {drawer && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-card-bg border-l border-card-border shadow-pop overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
              <h3 className="text-xs font-semibold text-text-primary truncate">{drawer.title}</h3>
              <button className={BTN_TOOLBAR} onClick={() => setDrawer(null)} aria-label={t('action-close')}>
                <X size={12} />
              </button>
            </div>
            <div className="px-3 py-2 space-y-3 text-xs">
              {drawer.nodeRefs && drawer.nodeRefs.length === 0 && (
                <p className="text-text-secondary">{t('topo-detail-none')}</p>
              )}
              {drawer.nodeRefs && drawer.nodeRefs.length > 0 && (
                <>
                  <p className="font-medium text-text-secondary">{t('topo-detail-policies')}</p>
                  {drawer.nodeRefs.map((ref, i) => (
                    <PolicyRow key={i} ref={ref} onLoad={() => void loadIntoEditor(ref)} />
                  ))}
                </>
              )}
              {grouped && [...grouped.entries()].map(([kind, list]) => (
                <div key={kind} className="space-y-1.5">
                  <p className="font-medium text-text-secondary">{kind}</p>
                  {list.map((p, i) => (
                    <div key={i} className="rounded border border-card-border px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-text-primary">
                          {p.ref.namespace ? `${p.ref.namespace}/` : ''}{p.ref.name}
                        </span>
                        <button className={BTN_SECONDARY} onClick={() => void loadIntoEditor(p.ref)}>
                          {t('topo-load-editor')}
                        </button>
                      </div>
                      {p.rules.length > 0 && (
                        <p className="text-[10px] text-text-secondary mt-0.5">{p.rules.join(', ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PolicyRow({ ref, onLoad }: { ref: PolicyRef; onLoad: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded border border-card-border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-text-primary">
          {ref.kind}: {ref.namespace ? `${ref.namespace}/` : ''}{ref.name}
        </span>
        <button className={BTN_SECONDARY} onClick={onLoad}>{t('topo-load-editor')}</button>
      </div>
    </div>
  );
}

/** Same predicate the engine applies to a spec: the endpointSelector matches
    ANY pod of the node. CCNP namespace scoping was already applied upstream by
    policiesForNamespace (with the ns labels), so no re-check here. */
function specAppliesToNode(
  spec: EngineSpec,
  labelsList: Array<Record<string, string>>,
): boolean {
  if (!labelsList.some(labels => selectorMatches(spec.endpointSelector, labels))) {
    return false;
  }
  // A contentful CCNP namespace scope can't be re-checked here without the
  // ns labels — the board already drew it, so the drawer must not contradict.
  return true;
}
