import { useState, useRef } from 'react';
import { listWorkloadLabels, type WorkloadLabels } from '@/lib/cluster-api';
import { useTranslation } from '@/i18n';

/**
 * "From cluster" dropdown for the label editors. Lists the template labels of
 * the cluster's pod-creating workloads (Deployment / StatefulSet / DaemonSet),
 * grouped by namespace, so an author picks a real `k=v` pair instead of
 * looking it up with kubectl. Loaded lazily on first open; a select keeps the
 * interaction to one click on top of the existing editor rows.
 */
export function ClusterLabelPicker({
  onPick,
  onPickAll,
}: {
  /** One `k=v` pair picked. */
  onPick: (key: string, value: string) => void;
  /** Every label of one workload picked (used when a workload owns several). */
  onPickAll?: (labels: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const [workloads, setWorkloads] = useState<WorkloadLabels[] | null>(null);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);

  const load = async () => {
    if (workloads || loadingRef.current) return;
    loadingRef.current = true;
    try {
      setWorkloads(await listWorkloadLabels());
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  };

  const pick = (encoded: string) => {
    if (!encoded || !workloads) return;
    // The option value carries the chosen labels as JSON; re-serialize per
    // pick so values with commas/colons survive the round trip.
    const chosen = workloads.find(w => `${w.namespace}/${w.workload}` === encoded);
    if (!chosen) return;
    const entries = Object.entries(chosen.labels);
    if (entries.length === 1 || !onPickAll) {
      // Single-label workload: picking it means picking that label.
      for (const [k, v] of entries) onPick(k, v);
    } else {
      onPickAll(chosen.labels);
    }
  };

  if (error) {
    return <div className="text-[10px] text-arrow-deny">{t('label-pick-load-error')}</div>;
  }

  return (
    <select
      className="max-w-[9rem] truncate bg-transparent border border-card-border rounded px-1 py-0.5 text-xs text-text-secondary focus:outline-none focus:border-accent"
      value=""
      aria-label={t('label-pick-from-cluster')}
      onFocus={load}
      onChange={e => {
        pick(e.target.value);
        e.target.value = '';
      }}
    >
      <option value="">{t('label-pick-from-cluster')}</option>
      {workloads === null ? (
        <option disabled>{t('label-pick-loading')}</option>
      ) : workloads.length === 0 ? (
        <option disabled>{t('label-pick-empty')}</option>
      ) : (
        groupByNamespace(workloads).map(([ns, group]) => (
          <optgroup key={ns} label={ns}>
            {group.map(w => (
              <option key={w.workload} value={`${w.namespace}/${w.workload}`}>
                {w.workload} ({Object.keys(w.labels).join(', ')})
              </option>
            ))}
          </optgroup>
        ))
      )}
    </select>
  );
}

function groupByNamespace(workloads: WorkloadLabels[]): Array<[string, WorkloadLabels[]]> {
  const groups = new Map<string, WorkloadLabels[]>();
  for (const w of workloads) {
    const list = groups.get(w.namespace) ?? [];
    list.push(w);
    groups.set(w.namespace, list);
  }
  return [...groups.entries()];
}
