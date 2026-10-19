import '@xyflow/react/dist/style.css';

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
} from '@xyflow/react';
import { TopologyNodeCard, type TopologyNodeData } from './TopologyNodeCard';
import { TopologyEdgeLine, TOPO_MARKER } from './TopologyEdgeLine';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './dagre-layout';
import type { TopologyGraph } from './topology-engine';
import { useHtmlTheme } from '@/components/canvas/flow/useHtmlTheme';

/**
 * Render the engine's graph as a React Flow diagram. Nodes are laid out by
 * dagre and are NOT draggable (spec story 14): the layout is authoritative
 * and a drag would desync it from the edges.
 */

const nodeTypes = { topo: TopologyNodeCard };
const edgeTypes = { topo: TopologyEdgeLine };

export interface TopologyCanvasProps {
  graph: TopologyGraph;
  /** Namespace node clicked (spec story 8) — undefined for anything else. */
  onJumpNamespace: (ns: string) => void;
  /** Any node clicked — opens the details drawer. */
  onNodeClick: (nodeId: string) => void;
}

export function TopologyCanvas({ graph, onJumpNamespace, onNodeClick }: TopologyCanvasProps) {
  const colorMode = useHtmlTheme();

  const { nodes, edges } = useMemo(() => {
    const positions = layoutGraph(graph.nodes, graph.edges);
    const rfNodes: Node<TopologyNodeData>[] = graph.nodes.map(n => ({
      id: n.id,
      type: 'topo',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { topo: n, jumpable: n.type === 'namespace' },
      draggable: false,
      selectable: true,
      // Declared dimensions let dagre positions land before first measurement.
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
    }));
    const rfEdges: Edge[] = graph.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'topo',
      zIndex: 100, // RF stacks edges below nodes by default — same fix as the editor canvas.
      markerEnd: { ...TOPO_MARKER },
      data: { bidirectional: e.bidirectional },
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [graph]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesConnectable={false}
      edgesFocusable
      onNodeClick={(_, node) => {
        const data = node.data as TopologyNodeData;
        if (data.jumpable) onJumpNamespace(data.topo.detail ?? '');
        else onNodeClick(node.id);
      }}
      onEdgeClick={(_, edge) => onNodeClick(edge.id)}
      colorMode={colorMode}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={1.5}
    >
      {/* Transparent background keeps the app's bg-canvas gradient visible. */}
      <Background variant={BackgroundVariant.Dots} gap={24} size={1}
        style={{ ['--xy-background-color' as string]: 'transparent' }} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
