import type {
  Direction,
  Endpoint,
  EndpointKind,
  LabelSelector,
  Policy,
  PolicyFormat,
  RuleGroup,
} from '@/types/policy';

/**
 * Where the policy came from, and whether the editor matches the cluster.
 * A locally-created policy has no cluster origin; `applied` is set after a
 * successful apply and cleared on any subsequent edit (via MARK_UNSYNCED).
 */
export type ClusterSync = 'local' | 'unsynced' | 'applied';

/**
 * What the editor holds. `policy` is the document; `activeSpec` is which
 * selector group the canvas is currently showing.
 */
export interface EditorState {
  policy: Policy;
  activeSpec: number;
  /** Cluster origin / sync status; defaults to `local`. */
  clusterSync?: ClusterSync;
}

export type PolicyAction =
  | { type: 'SET_METADATA'; payload: { name?: string; namespace?: string } }
  | { type: 'SET_FORMAT'; payload: PolicyFormat }
  | { type: 'SET_ACTIVE_SPEC'; payload: { index: number } }
  | { type: 'ADD_SPEC'; payload?: { index?: number } }
  | { type: 'REMOVE_SPEC'; payload: { index: number } }
  | { type: 'SET_ENDPOINT_SELECTOR'; payload: LabelSelector }
  | { type: 'ADD_ENDPOINT'; payload: { direction: Direction; endpoint: Endpoint } }
  | { type: 'REMOVE_ENDPOINT'; payload: { direction: Direction; id: string } }
  | {
      type: 'UPDATE_ENDPOINT';
      payload: { direction: Direction; id: string; changes: Partial<Endpoint> };
    }
  | { type: 'SET_DEFAULT_DENY'; payload: { direction: Direction; value: boolean } }
  | { type: 'IMPORT_POLICY'; payload: Policy }
  | { type: 'SET_CLUSTER_SYNC'; payload: { sync: ClusterSync } }
  | { type: 'RESET'; payload?: { policy?: Policy } };

/* ── Metadata ── */

export const setMetadata = (name?: string, namespace?: string): PolicyAction => ({
  type: 'SET_METADATA',
  payload: { name, namespace },
});

export const setFormat = (format: PolicyFormat): PolicyAction => ({
  type: 'SET_FORMAT',
  payload: format,
});

/* ── Spec groups ── */

export const setActiveSpec = (index: number): PolicyAction => ({
  type: 'SET_ACTIVE_SPEC',
  payload: { index },
});

export const addSpec = (index?: number): PolicyAction => ({
  type: 'ADD_SPEC',
  payload: { index },
});

export const removeSpec = (index: number): PolicyAction => ({
  type: 'REMOVE_SPEC',
  payload: { index },
});

export const setEndpointSelector = (selector: LabelSelector): PolicyAction => ({
  type: 'SET_ENDPOINT_SELECTOR',
  payload: selector,
});

/* ── Endpoints ── */

export const addEndpoint = (direction: Direction, endpoint: Endpoint): PolicyAction => ({
  type: 'ADD_ENDPOINT',
  payload: { direction, endpoint },
});

export const removeEndpoint = (direction: Direction, id: string): PolicyAction => ({
  type: 'REMOVE_ENDPOINT',
  payload: { direction, id },
});

export const updateEndpoint = (
  direction: Direction,
  id: string,
  changes: Partial<Endpoint>,
): PolicyAction => ({
  type: 'UPDATE_ENDPOINT',
  payload: { direction, id, changes },
});

/* ── Default deny ── */

export const setDefaultDeny = (direction: Direction, value: boolean): PolicyAction => ({
  type: 'SET_DEFAULT_DENY',
  payload: { direction, value },
});

/* ── Whole policy ── */

export const importPolicy = (policy: Policy, clusterSync?: ClusterSync): PolicyAction => ({
  type: 'IMPORT_POLICY',
  payload: policy,
  // IMPORT_POLICY rebuilds the whole state; the sync marker rides along so a
  // cluster-loaded policy starts as unsynced.
  ...(clusterSync !== undefined ? { clusterSync } : {}),
});

export const setClusterSync = (sync: ClusterSync): PolicyAction => ({
  type: 'SET_CLUSTER_SYNC',
  payload: { sync },
});


export const resetPolicy = (policy?: Policy): PolicyAction => ({
  type: 'RESET',
  payload: { policy },
});

/**
 * Action creators the canvas uses, bundled so components only need two imports.
 * `makeEndpoint` keeps the picker call sites one-liners.
 */
export const endpointActions = {
  addEndpoint,
  removeEndpoint,
  updateEndpoint,
};

export type { Direction, Endpoint, EndpointKind, LabelSelector, RuleGroup };
