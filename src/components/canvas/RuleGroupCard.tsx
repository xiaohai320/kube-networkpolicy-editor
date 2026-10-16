import { useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { Direction, Endpoint, PolicyFormat } from '@/types/policy';
import { isK8sUnrepresentable } from '@/types/policy';
import { endpointSummary, portSummary } from '@/lib/summarize';
import { useTranslation } from '@/i18n';
import { BTN_ICON, BTN_ROW_REMOVE } from '@/components/ui/button';
import { setHoveredRule } from '@/lib/highlight-state';
import { RuleDialog } from './RuleDialog';
import type { SubTypeOption } from './RulePickers';

interface RuleGroupCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  subTypes: SubTypeOption[];
  rules: Endpoint[];
  direction: Direction;
  format: PolicyFormat;
  onAdd: (endpoint: Endpoint) => void;
  onUpdate: (id: string, changes: Partial<Endpoint>) => void;
  onDelete: (id: string) => void;
  duplicateIds: Set<string>;
  /** Per-rule-row connector (flow mode): one per rule row, keyed by rule id. */
  renderRowHandle?: (rule: Endpoint) => ReactNode;
}

type DialogState = { mode: 'add' } | { mode: 'edit'; rule: Endpoint } | null;

/**
 * One rule-group card: a column in the canvas with its rules.
 *
 * Adding and editing happen in {@link RuleDialog} — the previous inline
 * expansion grew inside a 280px-wide column and a labels rule (namespace,
 * namespace labels, pod labels, ports) pushed the card off the canvas.
 */
export function RuleGroupCard({
  icon,
  title,
  subtitle,
  subTypes,
  rules,
  direction,
  format,
  onAdd,
  onUpdate,
  onDelete,
  duplicateIds,
  renderRowHandle,
}: RuleGroupCardProps) {
  const { t, msg } = useTranslation();
  const [dialog, setDialog] = useState<DialogState>(null);
  const dirLabel = t(direction === 'ingress' ? 'direction-ingress' : 'direction-egress');

  return (
    <div className="bg-card-bg border border-card-border rounded-lg glow-card">
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-text-secondary shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-text-primary leading-tight">{title}</div>
          <div className="text-[10px] text-text-secondary leading-tight mt-0.5">{subtitle}</div>
        </div>
        <button
          onClick={() => setDialog({ mode: 'add' })}
          aria-label={t('dialog-new-rule', { direction: dirLabel, group: title })}
          className={`${BTN_ICON} nodrag nopan`}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Rule rows */}
      {rules.length > 0 && (
        <div className="border-t border-card-border divide-y divide-card-border/50">
          {rules.map(rule => {
            const summary = msg(endpointSummary(rule));
            const portSummaryText = portSummary(rule);
            const isDuplicate = duplicateIds.has(rule.id);
            const ciliumOnly = format === 'k8s' && isK8sUnrepresentable(rule);

            return (
              <div
                key={rule.id}
                className={isDuplicate ? 'bg-rating-2/10 relative' : 'relative'}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface/50 group nodrag nopan"
                  onMouseEnter={() => setHoveredRule(rule.id)}
                  onMouseLeave={() => setHoveredRule(null)}
                  onClick={() => setDialog({ mode: 'edit', rule })}
                >
                  {/* nodrag+nopan on the row: a press on a row must neither
                      drag the card nor pan the pane, and mouseup after a
                      stray drag must not open the edit dialog. The wrapper
                      div stays plain except `relative`, which gives the
                      per-row Handle its positioning context (RF handles are
                      absolute; without it they all anchor to the card's
                      vertical midpoint). */}
                  <span className="text-xs text-text-primary flex-1 truncate">
                    {summary}
                    {ciliumOnly && (
                      <span className="ml-1.5 text-[10px] text-text-secondary font-normal">
                        {t('picker-cilium-only')}
                      </span>
                    )}
                  </span>
                  {renderRowHandle?.(rule)}
                  {portSummaryText && (
                    <span className="text-[11px] text-text-secondary shrink-0 font-mono">
                      &rarr; {portSummaryText}
                    </span>
                  )}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onDelete(rule.id);
                    }}
                    aria-label={t('action-delete')}
                    className={`${BTN_ROW_REMOVE} opacity-0 group-hover:opacity-100 nodrag nopan`}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <RuleDialog
          direction={direction}
          groupLabel={title}
          subTypes={subTypes}
          rule={dialog.mode === 'edit' ? dialog.rule : undefined}
          onClose={() => setDialog(null)}
          onAdd={onAdd}
          onSave={onUpdate}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
