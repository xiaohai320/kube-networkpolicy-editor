import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Direction, Endpoint, RuleGroup } from '@/types/policy';
import { useActiveSpec } from '@/state/context';
import { findDuplicateRules } from '@/lib/validators';

/**
 * Per-direction rule data shared by all three rule-group nodes of that
 * direction. Each flow node mounts its own consumer of this data — without
 * the shared context, grouping and duplicate fingerprinting would run six
 * times per render (three nodes × two directions) on the hot edit path,
 * though each node only reads its own group's slice.
 */
export interface DirectionData {
  rules: Endpoint[];
  byGroup: Record<RuleGroup, Endpoint[]>;
  duplicateIds: Set<string>;
}

const DirectionDataContext = createContext<Record<Direction, DirectionData> | null>(null);

/** Empty group buckets for a direction without rules. */
const emptyGroups = (): Record<RuleGroup, Endpoint[]> => ({
  outside: [],
  namespace: [],
  cluster: [],
});

export function DirectionDataProvider({ children }: { children: ReactNode }) {
  const spec = useActiveSpec();

  const value = useMemo<Record<Direction, DirectionData>>(() => {
    const build = (direction: Direction): DirectionData => {
      const rules = (direction === 'ingress' ? spec?.ingress : spec?.egress) ?? [];
      const byGroup = emptyGroups();
      for (const rule of rules) byGroup[rule.group].push(rule);
      return { rules, byGroup, duplicateIds: findDuplicateRules(rules) };
    };
    return { ingress: build('ingress'), egress: build('egress') };
  }, [spec]);

  return <DirectionDataContext.Provider value={value}>{children}</DirectionDataContext.Provider>;
}

/** The shared per-direction data; must render under DirectionDataProvider. */
export function useDirectionData(direction: Direction): DirectionData {
  const ctx = useContext(DirectionDataContext);
  if (!ctx) throw new Error('useDirectionData outside DirectionDataProvider');
  return ctx[direction];
}
