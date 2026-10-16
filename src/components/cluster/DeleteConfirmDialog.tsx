import { useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useEscape } from '@/hooks/useEscape';
import { deleteClusterPolicies, type ClusterPolicyRef, type DeleteReport } from '@/lib/cluster-api';
import { PolicyKindBadge } from './PolicyKindBadge';

/**
 * Delete confirmation → result, one dialog shell for both states. Single
 * delete passes a one-element selection; bulk lists every row so the dialog
 * is the last line of defense against a mis-selection.
 */
export function DeleteConfirmDialog({
  refs,
  openTabCount,
  onClose,
}: {
  refs: ClusterPolicyRef[];
  openTabCount: (ref: ClusterPolicyRef) => number;
  onClose: (deletedSomething: boolean) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DeleteReport | null>(null);
  const anyManaged = refs.some(r => r.managed);
  // How many of the selection are open in editor tabs — the note tells the
  // user those tabs survive the delete (and "apply" from them re-creates).
  const withTabs = refs.filter(r => openTabCount(r) > 0);
  const title = t(refs.length === 1 ? 'cluster-delete-one-title' : 'cluster-delete-bulk-title');
  useEscape(() => {
    if (!busy) onClose(report !== null && report.deleted > 0);
  });

  const run = async () => {
    setBusy(true);
    setReport(await deleteClusterPolicies(refs));
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
      onClick={() => !busy && onClose(report !== null && report.deleted > 0)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-card-bg border border-card-border rounded-xl w-full max-w-md mx-4 shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        {report === null ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border">
              <Trash2 size={16} className="text-arrow-deny" />
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
            </div>
            <div className="px-4 py-4 space-y-3 max-h-[60vh] overflow-auto">
              <div className="space-y-0.5">
                {refs.map(r => (
                  <div
                    key={`${r.kind}/${r.namespace}/${r.name}`}
                    className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                  >
                    <PolicyKindBadge kind={r.kind} />
                    <span className="text-text-secondary shrink-0">{r.namespace}</span>
                    <span className="truncate text-text-primary">{r.name}</span>
                    {r.managed && (
                      <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-yellow-500">
                        <AlertTriangle size={10} />
                        {t('cluster-delete-managed-row')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {withTabs.length > 0 && (
                <div className="text-[11px] text-text-secondary">
                  {refs.length === 1
                    ? t('cluster-delete-open-tabs', { n: openTabCount(refs[0]!) })
                    : t('cluster-delete-open-tabs-bulk', { n: withTabs.length })}
                </div>
              )}
              {anyManaged && (
                <div className="flex items-start gap-1.5 text-[11px] text-yellow-500/90">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{t('cluster-delete-managed-note')}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-card-border">
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary border border-card-border rounded hover:text-text-primary hover:bg-surface transition-colors"
                onClick={() => onClose(false)}
                disabled={busy}
              >
                {t('modal-cancel')}
              </button>
              <button
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 border border-red-600 rounded hover:bg-red-500 transition-colors disabled:opacity-50"
                onClick={() => void run()}
                disabled={busy}
              >
                {busy ? t('cluster-delete-deleting') : t('cluster-delete-confirm')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-card-border">
              <AlertTriangle size={16} className={report.failed.length > 0 ? 'text-yellow-500' : 'text-accent'} />
              <h3 className="text-sm font-semibold text-text-primary">{t('cluster-delete-result-title')}</h3>
            </div>
            <div className="px-4 py-4 space-y-2 max-h-[60vh] overflow-auto text-xs">
              <div className="text-text-primary">{t('cluster-delete-result-summary', { deleted: report.deleted, failed: report.failed.length })}</div>
              {report.failed.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-yellow-500 mb-1">{t('cluster-delete-result-failed-heading')}</div>
                  <div className="space-y-0.5">
                    {report.failed.map(({ ref, message }) => (
                      <div key={`${ref.kind}/${ref.namespace}/${ref.name}`} className="px-2 py-1 rounded bg-surface text-text-secondary">
                        <span className="text-text-primary">{ref.namespace}/{ref.name}</span>
                        <span className="block font-mono text-[10px] break-all">{message}</span>
                      </div>
                    ))}
                  </div>
                  {/*
                    A 404 was counted as deleted, so a failure here means RBAC
                    or upstream trouble — listing the upstream message verbatim
                    is the actionable part.
                  */}
                </div>
              )}
            </div>
            <div className="flex justify-end px-4 py-3 border-t border-card-border">
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary border border-card-border rounded hover:text-text-primary hover:bg-surface transition-colors"
                onClick={() => onClose(report.deleted > 0)}
              >
                {t('action-close')}
              </button>
              {/*
                onClose(true) tells the panel to refresh: something was removed
                and the inventory is stale.
              */}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
