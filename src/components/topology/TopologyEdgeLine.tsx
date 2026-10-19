import {
  BaseEdge,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from '@xyflow/react';

/**
 * The topology's only edge kind — an allowed path (green, per the editor's
 * visual language). Bidirectional paths get arrowheads on both ends; a plain
 * arrow would lie about a two-way allow.
 */

/** Same arrow as the editor canvas, sized for the denser topology graph. */
const MARKER = {
  type: 'arrowclosed' as const,
  color: 'var(--color-arrow-allow)',
  width: 20,
  height: 15,
  markerUnits: 'userSpaceOnUse' as const,
};

export function TopologyEdgeLine({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  // Cross-rank edges are long horizontals — a smooth step reads better than a
  // bezier sag when source and target sit at very different heights.
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: sourcePosition ?? Position.Right,
    targetX,
    targetY,
    targetPosition: targetPosition ?? Position.Left,
    borderRadius: 12,
  });
  const bidirectional = (data as { bidirectional?: boolean } | undefined)?.bidirectional === true;

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      markerStart={bidirectional ? markerEnd : undefined}
      style={{ stroke: 'var(--color-arrow-allow)', strokeWidth: 2 }}
    />
  );
}

/** The marker the topology canvas wires up for every TopologyEdgeLine. */
export const TOPO_MARKER = { ...MARKER };
