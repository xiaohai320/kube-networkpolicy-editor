import { Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { BTN_ICON, BTN_ROW_REMOVE } from './button';

export interface PolicyPage {
  id: string;
  label: string;
}

interface PolicyPageBarProps {
  pages: PolicyPage[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function PolicyPageBar({ pages, activeId, onSelect, onAdd, onRemove }: PolicyPageBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-surface border-b border-divider shrink-0 overflow-x-auto">
      {pages.map(page => (
        <div
          key={page.id}
          className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t text-sm font-medium cursor-pointer transition-colors ${
            page.id === activeId
              ? 'bg-card-bg text-text-primary border border-b-0 border-card-border'
              : 'text-text-secondary hover:text-text-primary hover:bg-card-bg/50'
          }`}
          onClick={() => onSelect(page.id)}
        >
          {/* The label mirrors the policy's namespace/name (App keeps it in
              sync) — not editable: a manual rename would be clobbered by the
              next policy edit. */}
          <span className="outline-none min-w-[40px] font-mono text-xs">
            {page.label}
          </span>
          {pages.length > 1 && (
            <button
              onClick={e => {
                e.stopPropagation();
                onRemove(page.id);
              }}
              aria-label={`${t('action-delete')} ${page.label}`}
              className={`${BTN_ROW_REMOVE} opacity-0 group-hover:opacity-100`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        className={BTN_ICON}
        title={t('action-add-page')}
        aria-label={t('action-add-page')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
