import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { MatchExpression } from '@/types/policy';
import { LabelEditor } from './LabelEditor';
import { ExpressionEditor } from './ExpressionEditor';
import { validatePolicyName, validateNamespace } from '@/lib/validators';
import { useTranslation } from '@/i18n';
import { useEscape } from '@/hooks/useEscape';
import {
  BTN_ICON_REMOVE,
  BTN_PRIMARY,
  BTN_PRIMARY_DISABLED,
  BTN_SECONDARY,
} from '../ui/button';

interface PodSelectorModalProps {
  policyName: string;
  namespace: string;
  podSelector: Record<string, string>;
  matchExpressions?: MatchExpression[];
  onSave: (data: {
    policyName: string;
    namespace: string;
    podSelector: Record<string, string>;
    matchExpressions: MatchExpression[];
  }) => void;
  onClose: () => void;
}

export function PodSelectorModal({
  policyName: initName,
  namespace: initNs,
  podSelector: initLabels,
  matchExpressions: initExpressions = [],
  onSave,
  onClose,
}: PodSelectorModalProps) {
  const { t, msg } = useTranslation();
  const [policyName, setPolicyName] = useState(initName);
  const [namespace, setNamespace] = useState(initNs);
  const [podSelector, setPodSelector] = useState<Record<string, string>>(initLabels);
  const [matchExpressions, setMatchExpressions] = useState<MatchExpression[]>(initExpressions);
  const [selectAll, setSelectAll] = useState(
    Object.keys(initLabels).length === 0 && initExpressions.length === 0,
  );

  useEscape(onClose);

  const nameError = validatePolicyName(policyName);
  const nsError = validateNamespace(namespace);
  const hasErrors = nameError !== null || nsError !== null;

  const handleSave = () => {
    if (hasErrors) return;
    onSave({
      policyName: policyName.trim(),
      namespace: namespace.trim(),
      podSelector: selectAll ? {} : podSelector,
      matchExpressions: selectAll ? [] : matchExpressions,
    });
    onClose();
  };

  // Portal to <body>: this modal renders inside a React Flow node whose
  // wrapper carries a transform, which would otherwise become the containing
  // block for `fixed` — dimming only the card instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('modal-title')}
        className="bg-card-bg border border-card-border rounded-xl w-full max-w-md mx-4 shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
          <h3 className="text-sm font-semibold text-text-primary">{t('modal-title')}</h3>
          <button
            onClick={onClose}
            aria-label={t('action-close')}
            className={BTN_ICON_REMOVE}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              {t('modal-policy-name')}
            </label>
            <input
              className={`w-full border rounded px-3 py-1.5 text-sm bg-transparent text-text-primary focus:outline-none ${
                nameError ? 'border-arrow-deny' : 'border-card-border focus:border-accent'
              }`}
              value={policyName}
              placeholder={t('placeholder-policy-name')}
              onChange={e => setPolicyName(e.target.value)}
            />
            {nameError && <div className="text-[10px] text-arrow-deny mt-0.5">{msg(nameError)}</div>}
          </div>

          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              {t('modal-namespace')}
            </label>
            <input
              className={`w-full border rounded px-3 py-1.5 text-sm bg-transparent text-text-primary focus:outline-none ${
                nsError ? 'border-arrow-deny' : 'border-card-border focus:border-accent'
              }`}
              value={namespace}
              placeholder={t('placeholder-namespace-field')}
              onChange={e => setNamespace(e.target.value)}
            />
            {nsError && <div className="text-[10px] text-arrow-deny mt-0.5">{msg(nsError)}</div>}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="select-all"
              checked={selectAll}
              onChange={e => setSelectAll(e.target.checked)}
              className="rounded border-card-border"
            />
            <label htmlFor="select-all" className="text-xs text-text-secondary">
              {t('modal-select-all')}
            </label>
          </div>

          {!selectAll && (
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                {t('modal-pod-labels')}
              </label>
              <LabelEditor labels={podSelector} onChange={setPodSelector} />
            </div>
          )}

          {!selectAll && (
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">
                {t('modal-expressions')}
              </label>
              <ExpressionEditor expressions={matchExpressions} onChange={setMatchExpressions} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-card-border">
          <button onClick={onClose} className={BTN_SECONDARY}>
            {t('modal-cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={hasErrors}
            className={hasErrors ? `${BTN_PRIMARY} ${BTN_PRIMARY_DISABLED}` : BTN_PRIMARY}
          >
            {t('modal-save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
