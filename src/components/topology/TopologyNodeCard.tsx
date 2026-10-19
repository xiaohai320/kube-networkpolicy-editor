import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  Globe,
  Server,
  Database,
  ShieldCheck,
  ShieldAlert,
  Boxes,
  Landmark,
} from 'lucide-react';
import type { SpecialKind, TopologyNode } from './topology-engine';
import { useTranslation } from '@/i18n';
import type { TFunc } from '@/i18n';

/**
 * One topology card: workload (icon, name, ×N, readiness dot, deny badges) or
 * special endpoint (icon + label). Read-only — the card's only interaction is
 * selection for the details drawer, handled by RF's onNodeClick.
 */

/** I18n key per special kind. */
function specialLabel(kind: SpecialKind, label: string, t: TFunc): string {
  switch (kind) {
    case 'world': return t('topo-world');
    case 'host': return t('topo-host');
    case 'kube-apiserver': return t('topo-kube-apiserver');
    case 'cidr': return `${t('topo-cidr')} ${label}`;
    case 'namespace': return `${t('topo-namespace-node')}: ${label}`;
  }
}

const SPECIAL_ICONS: Record<SpecialKind, typeof Globe> = {
  world: Globe,
  host: Server,
  'kube-apiserver': Landmark,
  cidr: Database,
  namespace: Boxes,
};

export interface TopologyNodeData extends Record<string, unknown> {
  topo: TopologyNode;
  /** Namespace nodes are clickable to jump (spec story 8); the rest aren't. */
  jumpable?: boolean;
}

export function TopologyNodeCard({ data }: NodeProps<Node<TopologyNodeData>>) {
  const { t } = useTranslation();
  const node = data.topo;

  const isWorkload = node.type === 'workload';
  const Icon = isWorkload ? Boxes : SPECIAL_ICONS[node.type as SpecialKind];
  const label = isWorkload ? node.label : specialLabel(node.type as SpecialKind, node.label, t);

  return (
    <div
      className={`rounded-lg border bg-card-bg shadow-sm px-3 py-2 w-[200px] select-none ${
        isWorkload ? 'border-card-border' : 'border-dashed border-card-border'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-text-secondary shrink-0">
          <Icon size={16} />
        </span>
        <span className="text-xs font-medium text-text-primary truncate flex-1" title={label}>
          {label}
        </span>
        {isWorkload && node.count !== undefined && node.count > 0 && (
          <span className="text-[10px] text-text-secondary shrink-0">×{node.count}</span>
        )}
        {isWorkload && node.ready !== undefined && (
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${node.ready ? 'bg-rating-4' : 'bg-rating-3'}`}
            title={node.ready ? undefined : t('topo-not-ready')}
          />
        )}
      </div>
      {isWorkload && (node.denyIngress || node.denyEgress) && (
        <div className="flex gap-1 mt-1.5">
          {node.denyIngress && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-arrow-deny bg-arrow-deny/10 rounded px-1">
              <ShieldAlert size={10} /> {t('topo-deny-ingress')}
            </span>
          )}
          {node.denyEgress && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-arrow-deny bg-arrow-deny/10 rounded px-1">
              <ShieldCheck size={10} /> {t('topo-deny-egress')}
            </span>
          )}
        </div>
      )}
      {/* Handles are invisible anchors for the dagre edges — the card itself
          never initiates a connection (nodesConnectable is false). */}
      <Handle type="target" position={Position.Left} className="invisible!" />
      <Handle type="source" position={Position.Right} className="invisible!" />
    </div>
  );
}
