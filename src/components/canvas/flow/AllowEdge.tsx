import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

/**
 * Every rule card is an *allow* rule, so every edge is the allow colour —
 * same rule the old ArrowLayer applied. Colour never reads as direction;
 * that comes from which column the card sits in. Red
 * (`--color-arrow-deny`) stays reserved for a direction that denies
 * everything, which only the target pod's badge shows.
 */
export function AllowEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={{ stroke: 'var(--color-arrow-allow)', strokeWidth: 2 }}
    />
  );
}

/** The default marker the flow wires up for every AllowEdge. */
export const ARROW_MARKER = {
  type: 'arrowclosed' as const,
  color: 'var(--color-arrow-allow)',
  width: 13,
  height: 10,
  // SVG markers scale with stroke width by default; the old ArrowLayer drew
  // the arrow at literal size (userSpaceOnUse), so keep that behaviour.
  markerUnits: 'userSpaceOnUse' as const,
};
