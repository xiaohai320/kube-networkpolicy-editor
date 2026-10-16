import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { useActiveSpec } from '@/state/context';
import { TargetFlowNode } from './TargetFlowNode';
import { RuleGroupFlowNode } from './RuleGroupFlowNode';
import { ColumnLabelNode } from './ColumnLabelNode';
import { AllowEdge } from './AllowEdge';
import { buildFlowEdges } from './edges';
import { DirectionDataProvider } from './direction-data';
import {
  layoutOffsets,
  TARGET_NODE_ID,
  columnLabelId,
  groupNodeId,
  GROUPS,
  GROUP_Y_START,
  GROUP_GAP,
} from './layout';
import { useHtmlTheme } from './useHtmlTheme';

/**
 * The visual canvas as a React Flow graph: rule-group cards, the target pod,
 * and a per-rule edge from each row to (or from) the target. Replaces the
 * fixed three-column flex layout and the hand-measured ArrowLayer — dragging
 * a card now moves its edges with it, zoom/pan are the library's.
 */

const nodeTypes = {
  target: TargetFlowNode,
  ruleGroup: RuleGroupFlowNode,
  columnLabel: ColumnLabelNode,
};

const edgeTypes = { allow: AllowEdge };

const columnIds = (direction: 'ingress' | 'egress'): string[] =>
  GROUPS.map(group => groupNodeId(direction, group));

/**
 * Re-flow one column's rule-group nodes top-down from their measured heights.
 * Keeps the stack start and a fixed gap between cards, replacing the seed's
 * generous 90px step as soon as RF reports real card dimensions.
 */
function restack(nodes: Node[], ids: string[]): Node[] {
  let y = GROUP_Y_START;
  return nodes.map(node => {
    if (!ids.includes(node.id)) return node;
    const height = node.measured?.height ?? node.height ?? 0;
    const positioned = { ...node, position: { ...node.position, y } };
    y += height + GROUP_GAP;
    return positioned;
  });
}

/** Static node seed; dragging later mutates the RF state copy by id. */
const seedNodes = (): Node[] => {
  const offsets = layoutOffsets();
  const base = (
    id: string,
    type: string,
    draggable: boolean,
    data: Record<string, unknown>,
  ): Node => ({
    id,
    type,
    position: offsets.get(id) ?? { x: 0, y: 0 },
    data,
    draggable,
    selectable: false,
    // Declared dimensions let RF place edges before first measurement —
    // content measures itself at runtime and corrects these.
    width: 260,
    height: 120,
  });
  return [
    base(columnLabelId('ingress'), 'columnLabel', false, { direction: 'ingress' }),
    base(columnLabelId('egress'), 'columnLabel', false, { direction: 'egress' }),
    base(TARGET_NODE_ID, 'target', true, {}),
    ...GROUPS.flatMap(group => [
      base(groupNodeId('ingress', group), 'ruleGroup', true, { direction: 'ingress', group }),
      base(groupNodeId('egress', group), 'ruleGroup', true, { direction: 'egress', group }),
    ]),
  ];
};

function FlowGraph() {
  const spec = useActiveSpec();
  const colorMode = useHtmlTheme();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seedNodes());

  /**
   * Columns whose cards the user has dragged: once a column is hand-placed,
   * its layout belongs to the user — the auto-restack must stop reflowing it
   * (a later height change would teleport their cards back into the stack).
   */
  const draggedColumns = useRef<Set<'ingress' | 'egress'>>(new Set());

  /**
   * Re-stack a direction's rule-group cards after their heights change (rule
   * added/removed). The seed's step is a guess; real heights arrive via
   * `measured` on dimension changes. Dragged columns are skipped — see
   * draggedColumns.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.id) {
          for (const dir of ['ingress', 'egress'] as const) {
            if (columnIds(dir).includes(c.id)) draggedColumns.current.add(dir);
          }
        }
      }
      if (!changes.some(c => c.type === 'dimensions')) return;
      for (const dir of ['ingress', 'egress'] as const) {
        if (!draggedColumns.current.has(dir)) {
          setNodes(current => restack(current, columnIds(dir)));
        }
      }
    },
    [onNodesChange, setNodes],
  );

  // Drags mutate RF state; policy edits never touch node identity, so no
  // sync from props is needed — the seed is authoritative for topology.

  // The rules themselves only shape the EDGES; node topology is fixed.
  const edges = useMemo<Edge[]>(
    () => buildFlowEdges(spec?.ingress ?? [], spec?.egress ?? []),
    [spec?.ingress, spec?.egress],
  );

  // fitView runs once on mount; when the pane itself resizes (divider drag,
  // window resize, cluster panel toggle) the layout would clip with no scroll
  // fallback — refit on pane size changes instead.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => fitView({ padding: 0.15, duration: 200 }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitView]);

  return (
    <div ref={wrapperRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        elementsSelectable={false}
        colorMode={colorMode}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        {/* The Background paints --xy-background-color as a solid fill (RF's
            dark default #141414) — transparent keeps the app's bg-canvas
            gradient visible under the dots. */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          style={{ ['--xy-background-color' as string]: 'transparent' }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/**
 * ReactFlowProvider backs useReactFlow (the resize refit); the data provider
 * shares per-direction rule grouping across the three nodes of each column.
 */
export function FlowCanvas() {
  return (
    <DirectionDataProvider>
      <ReactFlowProvider>
        <FlowGraph />
      </ReactFlowProvider>
    </DirectionDataProvider>
  );
}
