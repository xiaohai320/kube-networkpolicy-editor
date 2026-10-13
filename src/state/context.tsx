import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import type { Policy } from '@/types/policy';
import type { EditorState, PolicyAction } from './actions';
import { initialState, policyReducer } from './reducer';

interface PolicyContextValue {
  state: EditorState;
  dispatch: Dispatch<PolicyAction>;
  /** The policy with `activeSpec` ignored — what the YAML panel renders. */
  policy: Policy;
  /** The spec group the canvas is currently editing. */
  activeSpec: (state: EditorState) => number;
}

const PolicyContext = createContext<PolicyContextValue | null>(null);

interface PolicyProviderProps {
  children: ReactNode;
  initial?: EditorState;
  onStateChange?: (state: EditorState) => void;
}

export function PolicyProvider({ children, initial, onStateChange }: PolicyProviderProps) {
  const [state, dispatch] = useReducer(policyReducer, initial ?? initialState);

  // Keep the latest callback without making it a dependency: callers pass an
  // inline closure, and re-running the effect on every render would be a no-op
  // either way.
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    onStateChangeRef.current?.(state);
  }, [state]);

  const value: PolicyContextValue = {
    state,
    dispatch,
    policy: state.policy,
    activeSpec: (s: EditorState) => s.activeSpec,
  };

  return (
    <PolicyContext.Provider value={value}>
      {children}
    </PolicyContext.Provider>
  );
}

export function usePolicyContext(): PolicyContextValue {
  const ctx = useContext(PolicyContext);
  if (!ctx) {
    throw new Error('usePolicyContext must be used within a PolicyProvider');
  }
  return ctx;
}

/** The currently active spec, resolved from context. */
export function useActiveSpec() {
  const { state } = usePolicyContext();
  const index = Math.max(0, Math.min(state.activeSpec, state.policy.specs.length - 1));
  return state.policy.specs[index];
}
