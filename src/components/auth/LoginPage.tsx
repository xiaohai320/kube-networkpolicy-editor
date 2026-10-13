import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { login, startOidc } from '@/lib/auth-api';
import { useTranslation } from '@/i18n';

/**
 * Full-screen gate. Local admin login and the OIDC round-trip side by side;
 * the editor mounts only after a session exists (App polls /auth/me first).
 */
export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error && err.message === 'invalid-credentials'
        ? t('auth-bad-credentials')
        : t('auth-login-failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-canvas">
      <div className="bg-card-bg border border-card-border rounded-xl shadow-pop w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-2 mb-5">
          <ShieldCheck size={20} className="text-accent" />
          <h1 className="text-base font-semibold text-text-primary">{t('auth-title')}</h1>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={t('auth-username')}
            autoComplete="username"
            className="w-full border border-input-border rounded px-3 py-1.5 text-sm bg-input-bg text-input-text focus:outline-none focus:border-accent"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('auth-password')}
            autoComplete="current-password"
            className="w-full border border-input-border rounded px-3 py-1.5 text-sm bg-input-bg text-input-text focus:outline-none focus:border-accent"
          />
          {error && <div className="text-xs text-arrow-deny">{error}</div>}
          <button
            type="submit"
            disabled={busy || !username || !password}
            className={`w-full py-1.5 text-sm font-medium text-white bg-accent border border-accent rounded hover:opacity-90 ${busy || !username || !password ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {t('auth-login')}
          </button>
        </form>
        <button
          onClick={() => void startOidc()}
          className="w-full mt-3 py-1.5 text-sm border border-card-border rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
        >
          {t('auth-oidc')}
        </button>
      </div>
    </div>
  );
}
