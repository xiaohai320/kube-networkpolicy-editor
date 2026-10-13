import type { ReactNode } from 'react';
import type { Endpoint, RuleGroup } from '@/types/policy';
import { CidrEditor } from '@/components/editors/CidrEditor';
import { ExpressionEditor } from '@/components/editors/ExpressionEditor';
import { LabelEditor } from '@/components/editors/LabelEditor';
import { useTranslation } from '@/i18n';

export const INPUT_CLASS =
  'w-full bg-transparent border border-card-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent';

/** What `kind: 'all'` means in each column, in that column's own words. */
const ALL_SCOPE_KEY: Record<RuleGroup, string> = {
  outside: 'endpoint-any-endpoint',
  namespace: 'endpoint-any-pod',
  cluster: 'endpoint-all-cluster',
};

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-text-secondary block mb-1">{label}</label>
      {children}
    </div>
  );
}

/**
 * Kind-specific editors for one peer. Renders into the rule dialog.
 *
 * Group-aware: only the `cluster` group may leave the policy's namespace, so
 * that is the only place a namespace is a real choice. Inside the `namespace`
 * group a peer is by definition co-located with the policy, and asking for a
 * namespace there would be misleading.
 */
export function EndpointFields({
  rule,
  onUpdate,
}: {
  rule: Endpoint;
  onUpdate: (changes: Partial<Endpoint>) => void;
}) {
  const { t } = useTranslation();

  switch (rule.kind) {
    case 'cidr':
      return (
        <>
          <Field label={t('field-cidr')}>
            <input
              className={INPUT_CLASS}
              value={rule.cidr ?? ''}
              placeholder={t('placeholder-cidr')}
              onChange={e => onUpdate({ cidr: e.target.value })}
            />
          </Field>
          <Field label={t('field-except-cidr')}>
            <CidrEditor
              cidrs={rule.except ?? []}
              onChange={except => onUpdate({ except })}
              placeholder={t('action-add-exception')}
            />
          </Field>
        </>
      );

    case 'fqdn':
      return (
        <>
          <Field label={t('field-fqdn-name')}>
            <input
              className={INPUT_CLASS}
              value={rule.matchName ?? ''}
              placeholder={t('placeholder-hostname')}
              onChange={e => onUpdate({ matchName: e.target.value })}
            />
          </Field>
          <Field label={t('field-fqdn-pattern')}>
            <input
              className={INPUT_CLASS}
              value={rule.matchPattern ?? ''}
              placeholder={t('placeholder-fqdn-pattern')}
              onChange={e => onUpdate({ matchPattern: e.target.value })}
            />
          </Field>
        </>
      );

    case 'entity':
      return (
        <Field label={t('field-entity')}>
          <span className="text-xs text-text-primary">{rule.entity}</span>
        </Field>
      );

    case 'kube-dns':
      return (
        <Field label={t('field-entity')}>
          <span className="text-xs text-text-primary">
            {t('endpoint-kube-dns')}
            <span className="text-text-secondary"> {t('endpoint-kube-dns-detail')}</span>
          </span>
        </Field>
      );

    case 'service':
      // A service names its own namespace, which may well be a different one
      // (kube-system) than the policy's, so the field stays regardless of group.
      return (
        <>
          <Field label={t('field-namespace')}>
            <input
              className={INPUT_CLASS}
              value={rule.namespace ?? ''}
              placeholder={t('placeholder-namespace')}
              onChange={e => onUpdate({ namespace: e.target.value })}
            />
          </Field>
          <Field label={t('field-service-name')}>
            <input
              className={INPUT_CLASS}
              value={rule.serviceName ?? ''}
              placeholder={t('placeholder-service-name')}
              onChange={e => onUpdate({ serviceName: e.target.value })}
            />
          </Field>
        </>
      );

    case 'labels': {
      const crossNamespace = rule.group === 'cluster';
      return (
        <>
          {crossNamespace && (
            <Field label={t('field-namespace')}>
              <input
                className={INPUT_CLASS}
                value={rule.namespace ?? ''}
                placeholder={t('placeholder-all-namespaces')}
                onChange={e => onUpdate({ namespace: e.target.value })}
              />
            </Field>
          )}
          {crossNamespace && (
            <Field label={t('field-namespace-labels')}>
              <LabelEditor
                labels={rule.namespaceSelector ?? {}}
                onChange={namespaceSelector => onUpdate({ namespaceSelector })}
              />
            </Field>
          )}
          <Field label={t('field-pod-selector')}>
            <LabelEditor
              labels={rule.podSelector ?? {}}
              onChange={podSelector => onUpdate({ podSelector })}
            />
          </Field>
          <Field label={t('field-expressions')}>
            <ExpressionEditor
              expressions={rule.podExpressions ?? []}
              onChange={podExpressions => onUpdate({ podExpressions })}
            />
          </Field>
        </>
      );
    }

    case 'all':
      return (
        <Field label={t('field-scope')}>
          <span className="text-xs text-text-primary">{t(ALL_SCOPE_KEY[rule.group])}</span>
        </Field>
      );
  }
}
