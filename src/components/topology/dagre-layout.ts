/**
 * Auto-layout for the topology graph via dagre (layered). Nodes are not
 * draggable (spec story 14): the layout is authoritative, recomputed whenever
 * the graph changes.
 */

import dagre from 'dagre';
import type { TopologyNode } from './topology-engine';

/** Card geometry the renderer draws with; the layout must agree with it. */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;

/**
 * Lay the graph out left-to-right: workload nodes flow from the left toward
 * the special endpoints they reach. dagre mutates nothing — it returns fresh
 * positions keyed by node id.
 */
export function layoutGraph(
  nodes: TopologyNode[],
  edges: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 120, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    // dagre throws on self-loops; the engine never emits them, but a
    // defensive skip keeps a malformed input from crashing the board.
    if (edge.source !== edge.target) g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    // dagre centers nodes on their position; React Flow wants the top-left.
    const n = g.node(node.id) as { x: number; y: number } | undefined;
    if (n) {
      positions.set(node.id, { x: n.x - NODE_WIDTH / 2, y: n.y - NODE_HEIGHT / 2 });
    }
  }
  return positions;
}
