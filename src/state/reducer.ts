import type { Direction, Endpoint, Policy, PolicySpec } from '@/types/policy';
import { createDefaultPolicy, createDefaultSpec, mergeEndpoint } from '@/types/policy';
import type { EditorState, PolicyAction } from './actions';

export const initialState: EditorState = {
  policy: createDefaultPolicy(),
  activeSpec: 0,
};

/** Rebuild the policy with `fn` applied to spec `index`, leaving siblings alone. */
function mapSpec(policy: Policy, index: number, fn: (spec: PolicySpec) => PolicySpec): Policy {
  return {
    ...policy,
    specs: policy.specs.map((spec, i) => (i === index ? fn(spec) : spec)),
  };
}

/** The spec the canvas is editing, or a no-op stub when the index is stale. */
function clampSpecIndex(policy: Policy, index: number): number {
  if (policy.specs.length === 0) return 0;
  return Math.max(0, Math.min(index, policy.specs.length - 1));
}

function denyFlagFor(spec: PolicySpec, direction: Direction): boolean {
  return direction === 'ingress' ? spec.defaultDenyIngress : spec.defaultDenyEgress;
}

function toggleDeny(spec: PolicySpec, direction: Direction, value: boolean): PolicySpec {
  return direction === 'ingress'
    ? { ...spec, defaultDenyIngress: value }
    : { ...spec, defaultDenyEgress: value };
}

function mapEndpoints(
  spec: PolicySpec,
  direction: Direction,
  fn: (list: Endpoint[]) => Endpoint[],
): PolicySpec {
  return direction === 'ingress' ? { ...spec, ingress: fn(spec.ingress) } : { ...spec, egress: fn(spec.egress) };
}

export function policyReducer(state: EditorState, action: PolicyAction): EditorState {
  const specIndex = clampSpecIndex(state.policy, state.activeSpec);

  switch (action.type) {
    case 'SET_METADATA':
      return {
        ...state,
        policy: {
          ...state.policy,
          ...(action.payload.name !== undefined ? { name: action.payload.name } : {}),
          ...(action.payload.namespace !== undefined ? { namespace: action.payload.namespace } : {}),
        },
      };

    case 'SET_FORMAT':
      return { ...state, policy: { ...state.policy, format: action.payload } };

    case 'SET_ACTIVE_SPEC':
      return { ...state, activeSpec: clampSpecIndex(state.policy, action.payload.index) };

    case 'ADD_SPEC': {
      const specs = [...state.policy.specs];
      const insertAt = action.payload?.index ?? specs.length;
      specs.splice(Math.max(0, Math.min(insertAt, specs.length)), 0, createDefaultSpec());
      return {
        ...state,
        policy: { ...state.policy, specs },
        activeSpec: clampSpecIndex({ ...state.policy, specs }, insertAt),
      };
    }

    case 'REMOVE_SPEC': {
      const specs = state.policy.specs.filter((_, i) => i !== action.payload.index);
      if (specs.length === 0) return state;
      return {
        ...state,
        policy: { ...state.policy, specs },
        activeSpec: clampSpecIndex({ ...state.policy, specs }, state.activeSpec),
      };
    }

    case 'SET_ENDPOINT_SELECTOR':
      return {
        ...state,
        policy: mapSpec(state.policy, specIndex, spec => ({
          ...spec,
          endpointSelector: action.payload,
        })),
      };

    case 'ADD_ENDPOINT':
      return {
        ...state,
        policy: mapSpec(state.policy, specIndex, spec =>
          mapEndpoints(spec, action.payload.direction, list => [...list, action.payload.endpoint]),
        ),
      };

    case 'REMOVE_ENDPOINT':
      return {
        ...state,
        policy: mapSpec(state.policy, specIndex, spec =>
          mapEndpoints(spec, action.payload.direction, list =>
            list.filter(e => e.id !== action.payload.id),
          ),
        ),
      };

    case 'UPDATE_ENDPOINT':
      return {
        ...state,
        policy: mapSpec(state.policy, specIndex, spec =>
          mapEndpoints(spec, action.payload.direction, list =>
            list.map(e => (e.id === action.payload.id ? mergeEndpoint(e, action.payload.changes) : e)),
          ),
        ),
      };

    case 'SET_DEFAULT_DENY':
      return {
        ...state,
        policy: mapSpec(state.policy, specIndex, spec => {
          // Adding a rule clears default-deny; adding default-deny clears rules.
          if (action.payload.value) {
            return mapEndpoints(
              toggleDeny(spec, action.payload.direction, true),
              action.payload.direction,
              () => [],
            );
          }
          return toggleDeny(spec, action.payload.direction, false);
        }),
      };

    case 'IMPORT_POLICY':
      return { policy: action.payload, activeSpec: 0 };

    case 'RESET':
      return { policy: action.payload?.policy ?? createDefaultPolicy(), activeSpec: 0 };

    default:
      return state;
  }
}

/** The three ways a direction can actually behave. */
export type DirectionState = 'allow-all' | 'deny-all' | 'allow-list';

/**
 * Classifies a direction by its *effective* behaviour, not by which switch is
 * flipped. Rules win over the flag: in both formats an explicit rule is an
 * effective allow, so any non-empty list already implies a deny-all baseline and
 * the flag adds nothing. Reading the flag alone would paint a working allow rule
 * as "denied".
 *
 * The flag with rules empty is the one state where it decides on its own: set,
 * the direction denies everything; unset, it allows everything.
 */
export function directionState(
  spec: PolicySpec | undefined,
  direction: Direction,
): DirectionState {
  if (!spec) return 'allow-all';
  const rules = direction === 'ingress' ? spec.ingress : spec.egress;
  if (rules.length > 0) return 'allow-list';
  return denyFlagFor(spec, direction) ? 'deny-all' : 'allow-all';
}
