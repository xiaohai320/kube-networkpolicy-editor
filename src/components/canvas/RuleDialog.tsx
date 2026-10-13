import { useState } from 'react';
import { X } from 'lucide-react';
import type { Direction, Endpoint } from '@/types/policy';
import { mergeEndpoint } from '@/types/policy';
import { PortEditor } from '@/components/editors/PortEditor';
import { useTranslation } from '@/i18n';
import { useEscape } from '@/hooks/useEscape';
import {
  BTN_ICON_REMOVE,
  BTN_PRIMARY,
  BTN_PRIMARY_DISABLED,
  BTN_SECONDARY,
} from '@/components/ui/button';
import { EndpointFields } from './EndpointFields';
import type { SubTypeOption } from './RulePickers';

interface RuleDialogProps {
  direction: Direction;
  /** The group title, already translated: it disambiguates the three cards. */
  groupLabel: string;
  subTypes: SubTypeOption[];
  /** Set to edit an existing peer; absent to create a new one. */
  rule?: Endpoint;
  onClose: () => void;
  onAdd: (endpoint: Endpoint) => void;
  onSave: (id: string, changes: Partial<Endpoint>) => void;
  onDelete: (id: string) => void;
}

/**
 * Add and edit a rule from a dialog rather than an inline expansion.
 *
 * The old expansion grew inside a 280px-wide column, so a labels rule (namespace,
 * namespace labels, pod labels, ports) pushed the card past the canvas. The
 * dialog takes the same content but scrolls on its own, and its edits stay in a
 * draft until Save — Cancel really cancels.
 */
export function RuleDialog({
  direction,
  groupLabel,
  subTypes,
  rule,
  onClose,
  onAdd,
  onSave,
  onDelete,
}: RuleDialogProps) {
  const { t } = useTranslation();
  const editing = rule !== undefined;

  // A draft, not the live store: the column and the YAML panel should not
  // re-render on every keystroke, and Cancel must be a real no-op.
  const [draft, setDraft] = useState<Endpoint | null>(() => (rule ? clone(rule) : null));
  const [picked, setPicked] = useState<number | null>(null);

  useEscape(onClose);

  const patch = (changes: Partial<Endpoint>) =>
    setDraft(prev => (prev ? mergeEndpoint(prev, changes) : prev));

  const handlePick = (index: number) => {
    const option = subTypes[index];
    if (!option || option.disabled) return;
    setPicked(index);
    setDraft(clone(option.endpoint));
  };

  const handleConfirm = () => {
    if (!draft) return;
    if (editing) onSave(draft.id, { ...draft });
    else onAdd(draft);
    onClose();
  };

  const handleDelete = () => {
    if (!draft) return;
    onDelete(draft.id);
    onClose();
  };

  const dirLabel = t(direction === 'ingress' ? 'direction-ingress' : 'direction-egress');
  const title = editing
    ? t('dialog-edit-rule', { direction: dirLabel, group: groupLabel })
    : t('dialog-new-rule', { direction: dirLabel, group: groupLabel });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-card-bg border border-card-border rounded-xl w-full max-w-md mx-4 shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button onClick={onClose} aria-label={t('action-close')} className={BTN_ICON_REMOVE}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4 max-h-[min(65vh,520px)] overflow-y-auto">
          {!editing && (
            <div>
              <label className="text-[11px] font-medium text-text-secondary block mb-1.5">
                {t('dialog-rule-type')}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {subTypes.map((opt, i) => {
                  const active = picked === i;
                  return (
                    <button
                      key={i}
                      disabled={opt.disabled}
                      onClick={() => handlePick(i)}
                      className={`text-left rounded-md border px-2 py-1.5 transition-colors ${
                        opt.disabled
                          ? 'border-card-border opacity-40 cursor-not-allowed'
                          : active
                            ? 'border-accent bg-accent/10'
                            : 'border-card-border hover:border-accent/60 hover:bg-surface'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-text-secondary shrink-0">{opt.icon}</span>
                        <span className="text-xs font-medium text-text-primary truncate">
                          {opt.label}
                        </span>
                        {opt.disabled && opt.disabledLabel && (
                          <span className="text-[10px] text-text-secondary shrink-0">
                            {opt.disabledLabel}
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-text-secondary leading-tight mt-0.5">
                        {opt.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {draft && (
            <>
              <EndpointFields rule={draft} onUpdate={patch} />
              <div>
                <label className="text-[11px] font-medium text-text-secondary block mb-1">
                  {t('field-ports')}
                </label>
                <PortEditor ports={draft.ports} onChange={ports => patch({ ports })} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-card-border">
          {editing ? (
            <button
              onClick={handleDelete}
              className={`inline-flex items-center gap-1 ${BTN_SECONDARY} hover:text-arrow-deny`}
            >
              <X size={12} /> {t('action-delete')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className={BTN_SECONDARY}>
              {t('modal-cancel')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!draft}
              className={draft ? BTN_PRIMARY : `${BTN_PRIMARY} ${BTN_PRIMARY_DISABLED}`}
            >
              {editing ? t('modal-save') : t('dialog-add-rule')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Copy a peer into a draft, keeping its id so an edit can find it again. */
function clone(endpoint: Endpoint): Endpoint {
  return { ...endpoint, ports: endpoint.ports.map(p => ({ ...p })) };
}
