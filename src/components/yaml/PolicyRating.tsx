import { useMemo } from 'react';
import { usePolicyContext } from '@/state/context';
import { computeRating } from '@/lib/policy-rating';
import { useTranslation } from '@/i18n';

const KEYS = ['rate-1', 'rate-2', 'rate-3', 'rate-4'] as const;
const COLORS = ['bg-rating-1', 'bg-rating-2', 'bg-rating-3', 'bg-rating-4'] as const;
const HEIGHTS = ['h-1.5', 'h-3', 'h-4.5', 'h-6'] as const;

export function PolicyRating() {
  const { state } = usePolicyContext();
  const { t } = useTranslation();
  const rating = useMemo(() => computeRating(state.policy), [state.policy]);
  const label = t(KEYS[rating - 1]!);

  return (
    <div className="flex items-end gap-0.5" title={t('rating-title', { label, rating })}>
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className={`w-1.5 rounded-sm ${HEIGHTS[i - 1]} ${
            i <= rating ? COLORS[rating - 1] : 'bg-rating-inactive'
          }`}
        />
      ))}
      <span className="text-xs font-medium text-text-secondary ml-1">{label}</span>
    </div>
  );
}
