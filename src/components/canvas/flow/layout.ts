import type { Direction, RuleGroup } from '@/types/policy';

/** The rule-group columns, in stack order — the single source of truth. */
export const GROUPS: RuleGroup[] = ['outside', 'namespace', 'cluster'];

/**
 * Node ids are stable compound keys, so edges survive rule churn without
 * re-deriving identity: the target is one node, each (direction, group) pair
 * one more, the two column labels fixed.
 */
export const TARGET_NODE_ID = 'target';
export const columnLabelId = (direction: Direction) => `label-${direction}`;
export const groupNodeId = (direction: Direction, group: RuleGroup) =>
  `${direction}-${group}`;

/** Fixed column x positions; the vertical stack is computed per group. */
const COLUMN_X = { label: 0, ingress: 0, target: 420, egress: 840 } as const;
/** Column stack start, shared with FlowCanvas's restack. */
export const GROUP_Y_START = 60;
export const GROUP_GAP = 24;
/**
 * Seed-only step between stacked cards: deliberately larger than a measured
 * empty card so the pre-measurement layout doesn't overlap; the restack in
 * FlowCanvas replaces it with real heights + GROUP_GAP as soon as RF reports
 * dimensions.
 */
const GROUP_Y_STEP = 90;
const LABEL_Y = -40;

/** Initial node positions — session-only; dragging is not persisted. */
export function layoutOffsets(): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(columnLabelId('ingress'), { x: COLUMN_X.label, y: LABEL_Y });
  positions.set(columnLabelId('egress'), { x: COLUMN_X.label + COLUMN_X.egress, y: LABEL_Y });
  positions.set(TARGET_NODE_ID, { x: COLUMN_X.target, y: 120 });

  const yFor = (group: RuleGroup) =>
    GROUP_Y_START + GROUPS.indexOf(group) * GROUP_Y_STEP;
  positions.set(groupNodeId('ingress', 'outside'), { x: COLUMN_X.ingress, y: yFor('outside') });
  positions.set(groupNodeId('ingress', 'namespace'), { x: COLUMN_X.ingress, y: yFor('namespace') });
  positions.set(groupNodeId('ingress', 'cluster'), { x: COLUMN_X.ingress, y: yFor('cluster') });
  positions.set(groupNodeId('egress', 'outside'), { x: COLUMN_X.egress, y: yFor('outside') });
  positions.set(groupNodeId('egress', 'namespace'), { x: COLUMN_X.egress, y: yFor('namespace') });
  positions.set(groupNodeId('egress', 'cluster'), { x: COLUMN_X.egress, y: yFor('cluster') });

  return positions;
}

/**
 * One edge per rule row, matching the old ArrowLayer. The id embeds the rule
 * id for stable identity across rule churn (React keys off it); YAML-hover
 * highlighting itself runs through lib/highlight-state, not the DOM.
 */
export function edgeId(direction: Direction, ruleId: string): string {
  return `edge-${direction}-${ruleId}`;
}
