import { describe, it, expect } from 'vitest';
import { policyReducer, initialState } from '@/state/reducer';
import {
  setMetadata,
  setClusterSync,
  importPolicy,
  addEndpoint,
} from '@/state/actions';
import { newEndpoint } from '@/types/policy';

/** Cluster sync lifecycle: local → unsynced (cluster load) → applied → unsynced (edit). */
describe('cluster sync state', () => {
  it('defaults to local', () => {
    expect(initialState.clusterSync).toBeUndefined();
  });

  it('starts unsynced when a policy is imported from the cluster', () => {
    const state = policyReducer(initialState, importPolicy(initialState.policy, 'unsynced'));
    expect(state.clusterSync).toBe('unsynced');
  });

  it('stays local when imported without a marker', () => {
    const state = policyReducer(initialState, importPolicy(initialState.policy));
    expect(state.clusterSync).toBe('local');
  });

  it('applies then drops back to unsynced on any edit', () => {
    const applied = policyReducer(initialState, setClusterSync('applied'));
    expect(applied.clusterSync).toBe('applied');

    const edited = policyReducer(
      applied,
      setMetadata('renamed'),
    );
    expect(edited.clusterSync).toBe('unsynced');
  });

  it('marks unsynced on endpoint edits too', () => {
    const applied = policyReducer(initialState, setClusterSync('applied'));
    const edited = policyReducer(
      applied,
      addEndpoint('egress', newEndpoint('all', 'outside')),
    );
    expect(edited.clusterSync).toBe('unsynced');
  });

  it('keeps local policies local through edits', () => {
    const state = policyReducer(initialState, setMetadata('renamed'));
    expect(state.clusterSync ?? 'local').toBe('local');
  });
});
