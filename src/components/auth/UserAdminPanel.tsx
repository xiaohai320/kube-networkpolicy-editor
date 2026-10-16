import { useState, useCallback, useEffect } from 'react';
import { UserPlus, X, RefreshCw } from 'lucide-react';
import { listUsers, addUser, removeUser, changePassword } from '@/lib/auth-api';
import { useTranslation } from '@/i18n';
import { BTN_ADD, BTN_ROW_REMOVE, BTN_TOOLBAR_TEXT } from '../ui/button';

/**
 * Admin-only management: the OIDC allowlist (who may sign in) and the admin
 * password. Rendered as a page-level modal, opened from the toolbar; every
 * change is persisted by the backend to the Deployment env.
 */
export function UserAdminPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<string[]>([]);
  const [newUser, setNewUser] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMessage, setPwMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch {
      setError(t('auth-users-load-error'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = async () => {
    const name = newUser.trim();
    if (!name) return;
    setError(null);
    try {
      setUsers(await addUser(name));
      setNewUser('');
    } catch {
      setError(t('auth-users-save-error'));
    }
  };

  const handleRemove = async (name: string) => {
    setError(null);
    try {
      setUsers(await removeUser(name));
    } catch {
      setError(t('auth-users-save-error'));
    }
  };

  const handlePassword = async () => {
    setPwMessage(null);
    setError(null);
    try {
      await changePassword(current, next);
      setPwMessage(t('auth-password-changed'));
      setCurrent('');
      setNext('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      setPwMessage(status === 401 ? t('auth-bad-credentials') : t('auth-password-weak'));
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('auth-users-title')}
        className="bg-card-bg border border-card-border rounded-xl w-full max-w-md mx-4 shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
          <h3 className="text-sm font-semibold text-text-primary">{t('auth-users-title')}</h3>
          <button onClick={onClose} aria-label={t('action-close')} className={BTN_ROW_REMOVE}>
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5 max-h-[70vh] overflow-auto">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">{t('auth-allowed-users')}</label>
              <button className={BTN_TOOLBAR_TEXT} onClick={() => void refresh()} aria-label={t('cluster-load')}>
                <RefreshCw size={12} />
              </button>
            </div>
            <div className="flex gap-1 mb-2">
              <input
                value={newUser}
                onChange={e => setNewUser(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void handleAdd()}
                placeholder={t('auth-new-username')}
                className="flex-1 min-w-0 border border-input-border rounded px-2 py-1 text-xs bg-input-bg text-input-text focus:outline-none focus:border-accent"
              />
              <button className={BTN_ADD} onClick={() => void handleAdd()}>
                <UserPlus size={12} /> {t('auth-add-user')}
              </button>
            </div>
            {users.length === 0 ? (
              <div className="text-[11px] text-text-secondary py-1">{t('auth-no-users')}</div>
            ) : (
              <div className="space-y-0.5">
                {users.map(u => (
                  <div key={u} className="flex items-center justify-between px-2 py-1 rounded hover:bg-surface/60 text-xs">
                    <span className="text-text-primary font-mono truncate">{u}</span>
                    <button className={BTN_ROW_REMOVE} onClick={() => void handleRemove(u)} aria-label={`${t('action-remove')} ${u}`}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {error && <div className="text-[10px] text-arrow-deny mt-1">{error}</div>}
          </div>

          <div className="border-t border-divider pt-4">
            <label className="text-xs font-medium text-text-secondary block mb-1.5">{t('auth-change-password')}</label>
            <input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder={t('auth-current-password')}
              autoComplete="current-password"
              className="w-full mb-1.5 border border-input-border rounded px-2 py-1 text-xs bg-input-bg text-input-text focus:outline-none focus:border-accent"
            />
            <input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder={t('auth-new-password')}
              autoComplete="new-password"
              className="w-full mb-1.5 border border-input-border rounded px-2 py-1 text-xs bg-input-bg text-input-text focus:outline-none focus:border-accent"
            />
            <button className={BTN_ADD} onClick={() => void handlePassword()} disabled={!current || next.length < 8}>
              {t('auth-change-password')}
            </button>
            {pwMessage && <div className="text-[10px] text-text-secondary mt-1">{pwMessage}</div>}
          </div>

        </div>

        <div className="flex justify-end px-4 py-3 border-t border-card-border">
          <button className="px-3 py-1.5 text-xs font-medium text-text-secondary border border-card-border rounded hover:text-text-primary hover:bg-surface transition-colors" onClick={onClose}>
            {t('modal-cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
