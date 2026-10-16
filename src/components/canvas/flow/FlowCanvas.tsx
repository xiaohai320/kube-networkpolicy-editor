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
 * generous 90px step as soon as RF reports real card dimensions. Exported
 * for tests: the restack math is assertable directly, without depending on
 * happy-dom geometry.
 */
export function restack(nodes: Node[], ids: string[]): Node[] {
  let y = GROUP_Y_START;
  return nodes.map(node => {
    if (!ids.includes(node.id)) return node;
    const height = node.measured?.height ?? node.height ?? 0;
    const positioned = { ...node, position: { ...node.position, y } };
    y += height + GROUP_GAP;
    return positioned;
  });
}

/** Static node seed; dragging later mutates the RF state copy by id.
    Built once at module load — useNodesState ignores re-seeding anyway, and
    FlowGraph re-renders on every policy edit. */
const seedNodes = (): Node[] => {
  const offsets = layoutOffsets();
  const base = (id: string, type: string, data: Record<string, unknown>): Node => ({
    id,
    type,
    position: offsets.get(id) ?? { x: 0, y: 0 },
    data,
    draggable: false,
    selectable: false,
    // Declared dimensions let RF place edges before first measurement.
    // initialWidth/initialHeight (NOT width/height — those are pinned as
    // permanent inline styles) are dropped after the first real measurement,
    // so card heights correct themselves as rules are added.
    initialWidth: 260,
    initialHeight: 120,
  });
  return [
    base(columnLabelId('ingress'), 'columnLabel', { direction: 'ingress' }),
    base(columnLabelId('egress'), 'columnLabel', { direction: 'egress' }),
    base(TARGET_NODE_ID, 'target', {}),
    // Cards are fixed in their columns: dragging was session-only anyway,
    // and free placement let a drag bury a card under another. The restack
    // layout is authoritative.
    ...GROUPS.flatMap(group => [
      base(groupNodeId('ingress', group), 'ruleGroup', { direction: 'ingress', group }),
      base(groupNodeId('egress', group), 'ruleGroup', { direction: 'egress', group }),
    ]),
  ];
};

const SEED_NODES = seedNodes();

function FlowGraph() {
  const spec = useActiveSpec();
  const colorMode = useHtmlTheme();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(SEED_NODES);

  /**
   * Columns whose cards the user has actually MOVED: once a column is
   * hand-placed, its layout belongs to the user — the auto-restack must stop
   * reflowing it (a later height change would teleport their cards back into
   * the stack). Latching requires a real displacement, not just a settled
   * drag event: d3 emits one on sub-2px mouse jitter, which would otherwise
   * lock the column against its own consent.
   */
  const draggedColumns = useRef<Set<'ingress' | 'egress'>>(new Set());
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

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
        if (c.type !== 'position' || !c.id) continue;
        const columnId = (['ingress', 'egress'] as const).find(dir =>
          columnIds(dir).includes(c.id),
        );
        if (!columnId) continue;
        if (c.dragging) {
          // First change of a drag is the closest reading to the grab point;
          // later ones are already displaced.
          if (!dragStartPositions.current.has(c.id)) {
            dragStartPositions.current.set(c.id, {
              x: c.position?.x ?? 0,
              y: c.position?.y ?? 0,
            });
          }
        } else {
          // Drag settled. Latch only when the card ended somewhere meaningfully
          // different from where this drag began it.
          const start = dragStartPositions.current.get(c.id);
          dragStartPositions.current.delete(c.id);
          if (start && c.position) {
            const dx = c.position.x - start.x;
            const dy = c.position.y - start.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedColumns.current.add(columnId);
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

  // fitView runs once on mount. A pane resize (divider drag, window resize,
  // cluster panel toggle) can clip the laid-out cards — the old canvas
  // scrolled, RF doesn't — so refit, but ONLY while the user hasn't taken
  // over the viewport: after the first zoom/pan/drag, refitting would throw
  // away their position on every pixel of divider movement.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  const userMovedViewport = useRef(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!userMovedViewport.current) fitView({ padding: 0.15 });
    });
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
        // The canvas has no user-created connections — leaving the default
        // true arms every invisible handle as a click/drag connection point.
        nodesConnectable={false}
        colorMode={colorMode}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
      onMoveStart={() => {
        userMovedViewport.current = true;
      }}
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
