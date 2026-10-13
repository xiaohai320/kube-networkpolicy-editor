import { useState, useCallback, useMemo } from 'react';
import {
  Cloud,
  RefreshCw,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import {
  listClusterPolicies,
  getClusterPolicyYaml,
  loadDevCredentials,
  saveDevCredentials,
  clearDevCredentials,
  ClusterApiError,
  isDevMode,
  type ClusterPolicyRef,
} from '@/lib/cluster-api';
import { detectAndParse, PolicyParseError } from '@/lib/yaml-parser';
import { BTN_TOOLBAR_TEXT } from '../ui/button';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface ClusterPanelProps {
  /** Load a parsed policy into a new editor page. */
  onLoadPolicy: (yaml: string, label: string) => void;
  onClose: () => void;
}

/**
 * The cluster inventory side panel: connect (dev), list, and load policies
 * into editor pages. Applying lives with the YAML panel — this panel only
 * reads.
 */
export function ClusterPanel({ onLoadPolicy, onClose }: ClusterPanelProps) {
  const { t } = useTranslation();
  const [creds, setCreds] = useState(loadDevCredentials);
  const [state, setState] = useState<LoadState>('idle');
  const [policies, setPolicies] = useState<ClusterPolicyRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nsFilter, setNsFilter] = useState('');
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const refs = await listClusterPolicies();
      setPolicies(refs);
      setState('loaded');
    } catch (err) {
      if (err instanceof ClusterApiError && err.status === 401) {
        // Invalid/expired credentials: drop them so the connect form reappears.
        clearDevCredentials();
        setCreds(undefined);
        setError(t('cluster-error-401'));
      } else {
        setError(err instanceof ClusterApiError ? err.message : t('cluster-load-error'));
      }
      setState('error');
    }
  }, [t]);

  const handleConnect = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const apiServer = String(form.get('apiServer') ?? '').replace(/\/+$/, '');
      const token = String(form.get('token') ?? '');
      saveDevCredentials({ apiServer, token });
      setCreds({ apiServer, token });
      void refresh();
    },
    [refresh],
  );

  const handleLoad = useCallback(
    async (ref: ClusterPolicyRef) => {
      try {
        const yaml = await getClusterPolicyYaml(ref);
        detectAndParse(yaml); // Validate before handing it to the page.
        onLoadPolicy(yaml, `${ref.namespace}/${ref.name}`);
      } catch (err) {
        setError(
          err instanceof PolicyParseError ? t(err.key, err.params) : t('cluster-load-error'),
        );
      }
    },
    [onLoadPolicy, t],
  );

  const namespaces = useMemo(
    () => Array.from(new Set(policies.map(p => p.namespace))).sort(),
    [policies],
  );
  const filtered = useMemo(
    () =>
      policies.filter(
        p =>
          (nsFilter === '' || p.namespace === nsFilter) &&
          (search === '' ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.namespace.toLowerCase().includes(search.toLowerCase())),
      ),
    [policies, nsFilter, search],
  );

  return (
    <aside
      className="w-72 shrink-0 bg-surface border-r border-divider flex flex-col min-h-0"
      role="complementary"
      aria-label={t('cluster-panel-title')}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-divider">
        <span className="text-sm font-semibold text-text-primary">{t('cluster-panel-title')}</span>
        <div className="flex items-center gap-1">
          <button
            className={BTN_TOOLBAR_TEXT}
            onClick={() => void refresh()}
            disabled={state === 'loading'}
            aria-label={t('cluster-load')}
          >
            {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button className={BTN_TOOLBAR_TEXT} onClick={onClose} aria-label={t('action-dismiss')}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Dev connect form: in-cluster the backend owns auth, so no form. */}
      {isDevMode() && !creds && (
        <form className="px-3 py-2 border-b border-divider flex flex-col gap-1.5" onSubmit={handleConnect}>
          <input
            name="apiServer"
            required
            placeholder={t('cluster-api-url')}
            className="text-xs px-2 py-1 rounded bg-canvas border border-card-border"
          />
          <textarea
            name="token"
            required
            rows={3}
            placeholder={t('cluster-token')}
            className="text-xs px-2 py-1 rounded bg-canvas border border-card-border font-mono"
          />
          <button type="submit" className={BTN_TOOLBAR_TEXT}>
            <Cloud size={14} />
            <span>{t('cluster-connect')}</span>
          </button>
        </form>
      )}

      {error && (
        <div className="px-3 py-1.5 text-xs text-red-300 bg-red-900/40 flex items-center gap-1">
          <AlertCircle size={12} />
          <span className="flex-1 text-red-300">{error}</span>
          <button className="underline" onClick={() => setError(null)}>
            {t('action-dismiss')}
          </button>
        </div>
      )}

      {state === 'loaded' && (
        <>
          <div className="flex gap-1 px-3 py-2 border-b border-divider">
            <select
              value={nsFilter}
              onChange={e => setNsFilter(e.target.value)}
              className="text-xs px-1 py-1 rounded bg-canvas border border-card-border flex-1 min-w-0"
              aria-label={t('cluster-namespace-filter')}
            >
              <option value="">{t('cluster-namespace-filter')}</option>
              {namespaces.map(ns => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('cluster-search')}
              className="text-xs px-2 py-1 rounded bg-canvas border border-card-border flex-1 min-w-0"
            />
          </div>

          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-secondary">{t('cluster-empty')}</div>
            ) : (
              filtered.map(ref => (
                <button
                  key={`${ref.kind}/${ref.namespace}/${ref.name}`}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-card-bg/60 flex items-center gap-1.5"
                  onClick={() => void handleLoad(ref)}
                >
                  <span
                    className={`shrink-0 px-1 rounded text-[10px] font-mono ${
                      ref.kind === 'CiliumNetworkPolicy'
                        ? 'bg-orange-900/40 text-orange-300'
                        : 'bg-blue-900/40 text-blue-300'
                    }`}
                  >
                    {ref.kind === 'CiliumNetworkPolicy' ? 'CNP' : 'NP'}
                  </span>
                  <span className="text-text-secondary shrink-0">{ref.namespace}</span>
                  <span className="truncate text-text-primary">{ref.name}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
