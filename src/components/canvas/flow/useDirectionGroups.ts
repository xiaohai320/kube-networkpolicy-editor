import { useCallback } from 'react';
import type { Direction, Endpoint } from '@/types/policy';
import { cloneEndpoint } from '@/types/policy';
import { usePolicyContext } from '@/state/context';
import { addEndpoint, removeEndpoint, updateEndpoint } from '@/state/actions';
import { useDirectionData } from './direction-data';

/**
 * The rule bookkeeping the old DirectionColumn owned, now backed by the
 * shared per-direction data (see direction-data.tsx): grouping by RuleGroup,
 * the one-shot kube-dns guard, and the add/update/delete dispatches.
 */
export function useDirectionGroups(direction: Direction) {
  const { state, dispatch } = usePolicyContext();
  const { rules, byGroup, duplicateIds } = useDirectionData(direction);

  // The kube-dns shortcut is a one-shot affordance, so it hides itself once used.
  const hasKubeDns = direction === 'egress' && rules.some(r => r.kind === 'kube-dns');

  const handleAdd = useCallback(
    (endpoint: Endpoint) => {
      if (direction === 'egress' && endpoint.kind === 'kube-dns' && hasKubeDns) return;
      dispatch(addEndpoint(direction, cloneEndpoint(endpoint)));
    },
    [dispatch, direction, hasKubeDns],
  );

  const handleUpdate = useCallback(
    (id: string, changes: Partial<Endpoint>) => dispatch(updateEndpoint(direction, id, changes)),
    [dispatch, direction],
  );

  const handleDelete = useCallback(
    (id: string) => dispatch(removeEndpoint(direction, id)),
    [dispatch, direction],
  );

  return {
    byGroup,
    duplicateIds,
    hasKubeDns,
    format: state.policy.format,
    onAdd: handleAdd,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
  };
}
