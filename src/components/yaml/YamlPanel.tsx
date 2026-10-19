import { useState, useMemo, useCallback, useRef } from 'react';
import { Copy, Download, Upload, Check, CloudUpload, Loader2, AlertTriangle } from 'lucide-react';
import { usePolicyContext } from '@/state/context';
import { importPolicy, setFormat, setClusterSync as setClusterSyncAction } from '@/state/actions';
import { applyClusterPolicy, ClusterApiError } from '@/lib/cluster-api';
import { POLICY_FORMATS } from '@/lib/policy-format';
import { useHoveredRule } from '@/lib/highlight-state';
import { detectAndParse, PolicyParseError } from '@/lib/yaml-parser';
import { sanitizeFilename } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { YamlDisplay } from './YamlDisplay';
import { PolicyRating } from './PolicyRating';
import { PolicyWarnings } from './PolicyWarnings';
import { BTN_TOOLBAR_TEXT } from '../ui/button';

type TabId = 'k8s' | 'cilium';

export function YamlPanel() {
  const { state, dispatch } = usePolicyContext();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('k8s');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hoveredRuleId = useHoveredRule();

  const { yaml, activeRuleMap } = useMemo(() => {
    const mapped = POLICY_FORMATS[activeTab].generate(state.policy);
    // Only the hovered rule's range lights up. The lookup must tolerate a
    // stale id: deleting the hovered row unmounts it without a mouseleave, so
    // the store can still name a rule the generator no longer emitted.
    const range = hoveredRuleId !== null ? mapped.ruleMap[hoveredRuleId] : undefined;
    return {
      yaml: mapped.yaml,
      activeRuleMap: hoveredRuleId !== null && range ? { [hoveredRuleId]: range } : undefined,
    };
  }, [state.policy, activeTab, hoveredRuleId]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [yaml]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(state.policy.name)}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, state.policy.name]);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // `PolicyParseError` carries a message key; anything else is an unexpected
  // failure and gets the generic wording for the surface it came from.
  const parseErrorMessage = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof PolicyParseError) return t(err.key, err.params);
      return err instanceof Error ? t(fallback) : t('error-parse-file');
    },
    [t],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const { policy, format } = detectAndParse(text);
        dispatch(importPolicy(policy));
        setActiveTab(format);
        setError(null);
      } catch (err) {
        setError(parseErrorMessage(err, 'error-parse-file'));
      }

      // Reset file input
      e.target.value = '';
    },
    [dispatch, parseErrorMessage],
  );

  const handleApply = useCallback(async (force = false) => {
    setApplying(true);
    setError(null);
    setConflicted(false);
    try {
      // `yaml` is the live generated text — identical to what the panel shows.
      const manifest = yaml;
      await applyClusterPolicy(
        { kind: POLICY_FORMATS[activeTab].kind, namespace: state.policy.namespace, name: state.policy.name },
        manifest,
        { force },
      );
      dispatch(setClusterSyncAction('applied'));
      setApplied(true);
      setTimeout(() => setApplied(false), 1500);
    } catch (err) {
      if (err instanceof ClusterApiError && err.status === 409) {
        // Another controller (Helm/fleet/…) owns overlapping fields. Not an
        // error state: the themed banner explains and offers explicit takeover.
        setConflicted(true);
      } else if (err instanceof ClusterApiError) {
        setError(err.message);
      } else {
        setError(t('cluster-apply-error'));
      }
    } finally {
      setApplying(false);
    }
  }, [yaml, activeTab, state.policy, dispatch, t]);

  const handleYamlEdit = useCallback(
    (editedYaml: string) => {
      try {
        const { policy, format } = detectAndParse(editedYaml);
        // A cluster-originated policy stays cluster-relative even when the
        // user reshapes it in the YAML editor: it is still 'unsynced', never
        // downgraded to a locally-created policy.
        dispatch(importPolicy(policy, state.clusterSync === 'local' ? undefined : 'unsynced'));
        setActiveTab(format);
        setError(null);
      } catch (err) {
        setError(parseErrorMessage(err, 'error-parse-inline'));
      }
    },
    [dispatch, parseErrorMessage, state.clusterSync],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar + actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-divider shrink-0">
        <div className="flex gap-1">
          <TabButton
            label={t('tab-k8s')}
            active={activeTab === 'k8s'}
            onClick={() => {
              setActiveTab('k8s');
              dispatch(setFormat('k8s'));
            }}
          />
          <TabButton
            label={t('tab-cilium')}
            active={activeTab === 'cilium'}
            onClick={() => {
              setActiveTab('cilium');
              dispatch(setFormat('cilium'));
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <PolicyRating />
          <div className="w-px h-4 bg-divider" />
          <ActionButton
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            label={copied ? t('action-copied') : t('action-copy')}
            onClick={handleCopy}
          />
          <ActionButton icon={<Download size={14} />} label={t('action-download')} onClick={handleDownload} />
          <ActionButton icon={<Upload size={14} />} label={t('action-upload')} onClick={handleUpload} />
          <ActionButton
            icon={applying ? <Loader2 size={14} className="animate-spin" /> : applied ? <Check size={14} /> : <CloudUpload size={14} />}
            label={applying ? t('cluster-applying') : applied ? t('cluster-applied') : t('cluster-apply')}
            onClick={() => void handleApply()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Conflict banner: themed, explanatory, with an explicit force-apply exit */}
      {conflicted && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs bg-badge-deny-bg text-text-primary border-b border-badge-deny-border">
          <AlertTriangle size={12} className="text-arrow-deny shrink-0" />
          <span className="flex-1 min-w-0">{t('cluster-conflict')}</span>
          <button
            className="px-2 py-0.5 rounded border border-arrow-deny/60 text-arrow-deny hover:bg-surface transition-colors shrink-0"
            onClick={() => void handleApply(true)}
            disabled={applying}
          >
            {t('cluster-apply-force')}
          </button>
          <button className="text-text-secondary underline shrink-0" onClick={() => setConflicted(false)}>
            {t('action-dismiss')}
          </button>
        </div>
      )}

      {/* Error banner: theme tokens, not raw red-900 hardcodes */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs bg-badge-deny-bg text-text-primary border-b border-badge-deny-border">
          <AlertTriangle size={12} className="text-arrow-deny shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button className="text-text-secondary underline shrink-0" onClick={() => setError(null)}>
            {t('action-dismiss')}
          </button>
        </div>
      )}

      {/* Policy warnings */}
      <PolicyWarnings />

      {/* YAML display */}
      <div className="flex-1 overflow-auto">
        <YamlDisplay yaml={yaml} ruleMap={activeRuleMap} onYamlChange={handleYamlEdit} />
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`px-3 py-1.5 text-sm font-semibold rounded-t transition-colors ${
        active
          ? 'text-tab-active border-b-2 border-accent'
          : 'text-tab-inactive hover:text-text-primary'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={BTN_TOOLBAR_TEXT}
      onClick={onClick}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
