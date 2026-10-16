import { Handle, Position } from '@xyflow/react';
import { TargetPodNode } from '../TargetPodNode';

/**
 * The policy's target pod as a flow node. The card is the existing
 * TargetPodNode unchanged; the handles are the endpoints of the per-rule
 * edges — ingress rules arrive on the left, egress rules leave on the right.
 */
export function TargetFlowNode() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-transparent !border-0 !w-2 !h-2"
      />
      <TargetPodNode />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-transparent !border-0 !w-2 !h-2"
      />
    </>
  );
}
