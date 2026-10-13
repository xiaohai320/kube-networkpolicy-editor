import { useState } from 'react';
import { Braces, Pencil, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { Direction } from '@/types/policy';
import { useActiveSpec, usePolicyContext } from '@/state/context';
import { setDefaultDeny, setEndpointSelector, setMetadata } from '@/state/actions';
import type { DirectionState } from '@/state/reducer';
import { directionState } from '@/state/reducer';
import { PodSelectorModal } from '@/components/editors/PodSelectorModal';
import { selectorSummary } from '@/lib/summarize';
import { useTranslation } from '@/i18n';

export function TargetPodNode() {
  const { state, dispatch } = usePolicyContext();
  const spec = useActiveSpec();
  const { msg } = useTranslation();
  const [showModal, setShowModal] = useState(false);

  const ingressState = directionState(spec, 'ingress');
  const egressState = directionState(spec, 'egress');
  const ingressCount = spec?.ingress.length ?? 0;
  const egressCount = spec?.egress.length ?? 0;

  return (
    <>
      <div
        className="bg-card-bg border-2 border-accent/50 rounded-xl min-w-[240px] max-w-[260px] glow-card"
        data-target-pod
      >
        {/* Icon + Namespace header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border">
          <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <Braces size={20} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-text-primary truncate">{state.policy.namespace}</div>
            <div className="text-xs text-text-secondary truncate mt-0.5">
              {msg(selectorSummary(spec?.endpointSelector))}
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="w-8 h-8 rounded-lg border border-card-border flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent/50 transition-colors shrink-0"
          >
            <Pencil size={14} />
          </button>
        </div>

        {/*
         * Baseline badges. Three states, because with rules present the flag is
         * inert — the rule list is the policy. Red is reserved for deny-all.
         */}
        <div className="flex gap-2 px-4 py-3">
          <DenyBadge
            dir="ingress"
            state={ingressState}
            ruleCount={ingressCount}
            onToggleDeny={value => dispatch(setDefaultDeny('ingress', value))}
          />
          <DenyBadge
            dir="egress"
            state={egressState}
            ruleCount={egressCount}
            onToggleDeny={value => dispatch(setDefaultDeny('egress', value))}
          />
        </div>
      </div>

      {showModal && (
        <PodSelectorModal
          policyName={state.policy.name}
          namespace={state.policy.namespace}
          podSelector={spec?.endpointSelector.matchLabels ?? {}}
          matchExpressions={spec?.endpointSelector.matchExpressions ?? []}
          onSave={data => {
            dispatch(setMetadata(data.policyName, data.namespace));
            dispatch(
              setEndpointSelector({
                matchLabels: data.podSelector,
                matchExpressions: data.matchExpressions,
              }),
            );
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

interface DenyBadgeProps {
  dir: Direction;
  state: DirectionState;
  ruleCount: number;
  onToggleDeny: (value: boolean) => void;
}

function DenyBadge({ dir, state, ruleCount, onToggleDeny }: DenyBadgeProps) {
  const { t } = useTranslation();
  const label = t(dir === 'ingress' ? 'direction-ingress' : 'direction-egress');

  // Red means "denies everything". An allow-list is the opposite — the rules are
  // the policy and they work — so it reads as neutral, never denied.
  const denied = state === 'deny-all';
  const Icon = denied ? ShieldAlert : ShieldCheck;

  // Clickable only while the flag decides on its own. Once rules exist the
  // toggle would just fight the rule list, so it goes inert.
  const clickable = state !== 'allow-list';
  const plural = ruleCount !== 1 ? 's' : '';

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => onToggleDeny(!denied)}
      title={
        clickable
          ? t(denied ? 'target-click-allow' : 'target-click-deny', { label })
          : t('target-rules-implied', { label, count: ruleCount, suffix: plural })
      }
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-left ${
        denied
          ? 'bg-badge-deny-bg text-arrow-deny border border-badge-deny-border'
          : state === 'allow-list'
            ? 'bg-surface text-text-secondary border border-divider'
            : 'bg-badge-allow-bg text-arrow-allow border border-badge-allow-border'
      } ${clickable ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
    >
      <Icon size={12} />
      <span>
        {label}
        <br />
        <span className="font-medium text-[10px] opacity-80">
          {state === 'allow-list'
            ? t('target-allow-list', { count: ruleCount, suffix: plural })
            : t(denied ? 'target-default-deny' : 'target-default-allow')}
        </span>
      </span>
    </button>
  );
}
