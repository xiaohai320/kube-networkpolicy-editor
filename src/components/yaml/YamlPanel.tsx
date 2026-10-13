import { useState, useMemo, useCallback, useRef } from 'react';
import { Copy, Download, Upload, Check } from 'lucide-react';
import { usePolicyContext } from '@/state/context';
import { importPolicy, setFormat } from '@/state/actions';
import { generateK8sYaml } from '@/lib/yaml-gen-k8s';
import { generateCiliumYaml } from '@/lib/yaml-gen-cilium';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const yaml = useMemo(() => {
    return activeTab === 'k8s'
      ? generateK8sYaml(state.policy)
      : generateCiliumYaml(state.policy);
  }, [state.policy, activeTab]);

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

  const handleYamlEdit = useCallback(
    (editedYaml: string) => {
      try {
        const { policy, format } = detectAndParse(editedYaml);
        dispatch(importPolicy(policy));
        setActiveTab(format);
        setError(null);
      } catch (err) {
        setError(parseErrorMessage(err, 'error-parse-inline'));
      }
    },
    [dispatch, parseErrorMessage],
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-1.5 bg-red-900/40 text-red-300 text-xs border-b border-red-800">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>
            {t('action-dismiss')}
          </button>
        </div>
      )}

      {/* Policy warnings */}
      <PolicyWarnings />

      {/* YAML display */}
      <div className="flex-1 overflow-auto">
        <YamlDisplay yaml={yaml} onYamlChange={handleYamlEdit} />
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
