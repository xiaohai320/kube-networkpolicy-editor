import { useCallback, useMemo } from 'react';
import type { Direction, Endpoint, RuleGroup } from '@/types/policy';
import { cloneEndpoint } from '@/types/policy';
import { usePolicyContext, useActiveSpec } from '@/state/context';
import { addEndpoint, removeEndpoint, updateEndpoint } from '@/state/actions';
import { findDuplicateRules } from '@/lib/validators';
import { useTranslation } from '@/i18n';
import { RuleGroupCard } from './RuleGroupCard';
import { GROUP_SUBTITLES, GROUP_TITLES, pickersFor } from './RulePickers';

const GROUPS: RuleGroup[] = ['outside', 'namespace', 'cluster'];

/**
 * One side of the canvas. Ingress and egress differ only in the picker
 * template list, so both columns are thin wrappers over this.
 */
export function DirectionColumn({ direction }: { direction: Direction }) {
  const { state, dispatch } = usePolicyContext();
  const spec = useActiveSpec();
  const { t } = useTranslation();

  const rules = (direction === 'ingress' ? spec?.ingress : spec?.egress) ?? [];
  const title = direction === 'ingress' ? t('direction-ingress-sources') : t('direction-egress-destinations');

  const duplicateIds = useMemo(() => findDuplicateRules(rules), [rules]);

  const byGroup = useMemo(() => {
    const groups: Record<RuleGroup, Endpoint[]> = { outside: [], namespace: [], cluster: [] };
    for (const rule of rules) groups[rule.group].push(rule);
    return groups;
  }, [rules]);

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
    (id: string, changes: Partial<Endpoint>) => {
      dispatch(updateEndpoint(direction, id, changes));
    },
    [dispatch, direction],
  );

  const handleDelete = useCallback(
    (id: string) => dispatch(removeEndpoint(direction, id)),
    [dispatch, direction],
  );

  return (
    <div className="flex flex-col gap-3 w-full max-w-[280px]">
      <h3 className="text-base font-bold text-text-primary">{title}</h3>

      {GROUPS.map(group => {
        const { icon: Icon, key: titleKey } = GROUP_TITLES[group];
        return (
          <RuleGroupCard
            key={group}
            icon={<Icon size={16} />}
            title={t(titleKey)}
            subtitle={t(GROUP_SUBTITLES[group])}
            subTypes={pickersFor(t, direction, group, hasKubeDns)}
            rules={byGroup[group]}
            direction={direction}
            format={state.policy.format}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            duplicateIds={duplicateIds}
          />
        );
      })}
    </div>
  );
}
