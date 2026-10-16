import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { Direction, Endpoint, RuleGroup } from '@/types/policy';
import { useTranslation } from '@/i18n';
import { RuleGroupCard } from '../RuleGroupCard';
import { GROUP_SUBTITLES, GROUP_TITLES, pickersFor } from '../RulePickers';
import { useDirectionGroups } from './useDirectionGroups';

/** Payload the flow seed puts on every rule-group node, typed via data. */
export interface RuleGroupData extends Record<string, unknown> {
  direction: Direction;
  group: RuleGroup;
}

/**
 * One rule-group card as a flow node. Handles live on the rule rows
 * themselves (one per rule), so each edge anchors to its rule — the
 * per-rule-edge semantics the old ArrowLayer drew by hand.
 *
 * Direction and group ride in node.data (see RuleGroupData); the id remains
 * the stable `${direction}-${group}` key edges reference.
 */
export function RuleGroupFlowNode({ data }: NodeProps<Node<RuleGroupData>>) {
  const { t } = useTranslation();
  const { direction, group } = data;

  const { byGroup, duplicateIds, hasKubeDns, format, onAdd, onUpdate, onDelete } =
    useDirectionGroups(direction);

  const { icon: Icon, key: titleKey } = GROUP_TITLES[group];
  const isIngress = direction === 'ingress';

  return (
    <>
      {/* Ingress edges flow FROM the rules TO the target: rules are sources.
          Egress edges arrive FROM the target: rules are targets. */}
      <Handle
        type={isIngress ? 'target' : 'source'}
        position={Position.Left}
        className="!bg-transparent !border-0 !w-2 !h-2"
      />
      <RuleGroupCard
        icon={<Icon size={16} />}
        title={t(titleKey)}
        subtitle={t(GROUP_SUBTITLES[group])}
        subTypes={pickersFor(t, direction, group, hasKubeDns)}
        rules={byGroup[group]}
        direction={direction}
        format={format}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
        duplicateIds={duplicateIds}
        renderRowHandle={(rule: Endpoint) => (
          <Handle
            type={isIngress ? 'source' : 'target'}
            position={isIngress ? Position.Right : Position.Left}
            id={rule.id}
            className="!bg-transparent !border-0 !w-2 !h-2"
          />
        )}
      />
    </>
  );
}
