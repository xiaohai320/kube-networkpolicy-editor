import type { Direction, Endpoint } from '@/types/policy';
import type { Edge } from '@xyflow/react';
import { edgeId, groupNodeId, TARGET_NODE_ID } from './layout';
import { ARROW_MARKER } from './AllowEdge';

/**
 * One edge per rule row — the invariant the old ArrowLayer drew by hand.
 * Ingress rules source the edge (flow → target); egress rules receive it
 * (target → flow). The row's handle id is the rule id, so a rule knows which
 * row an edge anchors to without extra bookkeeping.
 */
export function buildFlowEdges(
  ingress: Endpoint[],
  egress: Endpoint[],
): Edge[] {
  const mk = (direction: Direction, rule: Endpoint): Edge => ({
    id: edgeId(direction, rule.id),
    type: 'allow',
    // RF stacks edges below nodes by default (both z-index 0, nodes later in
    // DOM order) — cards sit between columns tight enough to bury the whole
    // run, so the lines vanish. Draw edges above the cards.
    zIndex: 100,
    ...(direction === 'ingress'
      ? {
          source: groupNodeId(direction, rule.group),
          sourceHandle: rule.id,
          target: TARGET_NODE_ID,
        }
      : {
          source: TARGET_NODE_ID,
          target: groupNodeId(direction, rule.group),
          targetHandle: rule.id,
        }),
    markerEnd: { ...ARROW_MARKER },
  });
  return [...ingress.map(r => mk('ingress', r)), ...egress.map(r => mk('egress', r))];
}
