import type { NodeProps, Node } from '@xyflow/react';
import type { Direction } from '@/types/policy';
import { useTranslation } from '@/i18n';

/** Payload the flow seed puts on a column-label node. */
export interface ColumnLabelData extends Record<string, unknown> {
  direction: Direction;
}

/**
 * Non-interactive column heading ("Ingress Sources" / "Egress
 * Destinations"). A node rather than a div outside the flow so the heading
 * scrolls and zooms with the cards it titles. No handles: nothing connects
 * to a label. Direction comes in node.data, not from parsing the id.
 */
export function ColumnLabelNode({ data }: NodeProps<Node<ColumnLabelData>>) {
  // `Node` here is the @xyflow/react Node type (imported above), not DOM Node.

  const { t } = useTranslation();
  return (
    <div className="px-2 select-none">
      <h3 className="text-base font-bold text-text-primary whitespace-nowrap">
        {t(
          data.direction === 'egress'
            ? 'direction-egress-destinations'
            : 'direction-ingress-sources',
        )}
      </h3>
    </div>
  );
}
