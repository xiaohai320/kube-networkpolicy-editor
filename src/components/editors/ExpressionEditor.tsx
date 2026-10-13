import { useCallback, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { LabelOperator, MatchExpression } from '@/types/policy';
import { generateId } from '@/lib/utils';
import { validateLabelKey } from '@/lib/validators';
import { tr, useTranslation } from '@/i18n';
import { BTN_ADD, BTN_ROW_REMOVE } from '../ui/button';

const OPERATORS: LabelOperator[] = ['In', 'NotIn', 'Exists', 'DoesNotExist'];
const NO_VALUE_OPERATORS = new Set<LabelOperator>(['Exists', 'DoesNotExist']);

const inputClass =
  'w-full bg-transparent border border-card-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent';

interface ExpressionRow extends MatchExpression {
  id: string;
}

interface ExpressionEditorProps {
  expressions: MatchExpression[];
  onChange: (expressions: MatchExpression[]) => void;
}

function toRows(expressions: MatchExpression[]): ExpressionRow[] {
  return expressions.map(e => ({ ...e, id: generateId(), values: [...(e.values ?? [])] }));
}

function toExpressions(rows: ExpressionRow[]): MatchExpression[] {
  return rows
    .filter(r => r.key.trim() !== '')
    .map(({ key, operator, values }) => ({ key: key.trim(), operator, values }));
}

export function ExpressionEditor({ expressions, onChange }: ExpressionEditorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ExpressionRow[]>(() => toRows(expressions));
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commit = useCallback(
    (next: ExpressionRow[]) => {
      setData(next);
      onChange(toExpressions(next));
    },
    [onChange],
  );

  const updateRow = (rowId: string, patch: Partial<ExpressionRow>) => {
    commit(data.map(r => (r.id === rowId ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-1">
      {data.length > 0 && (
        <div className="space-y-1">
          {data.map(row => {
            const noValue = NO_VALUE_OPERATORS.has(row.operator);
            const valueText: string = drafts[row.id] ?? row.values.join(', ');
            const keyError = row.key ? validateLabelKey(row.key) : null;
            return (
              <div key={row.id} className="flex items-start gap-1">
                <input
                  className={`${inputClass} ${keyError ? 'border-arrow-deny' : 'focus:border-accent'}`}
                  value={row.key}
                  placeholder={t('placeholder-expression-key')}
                  onChange={e => updateRow(row.id, { key: e.target.value })}
                />
                <select
                  className="w-24 bg-transparent border border-card-border rounded px-1 py-1 text-xs focus:outline-none focus:border-accent"
                  value={row.operator}
                  onChange={e =>
                    updateRow(row.id, {
                      operator: e.target.value as LabelOperator,
                      ...(NO_VALUE_OPERATORS.has(e.target.value as LabelOperator)
                        ? { values: [] }
                        : {}),
                    })
                  }
                >
                  {OPERATORS.map(op => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                {!noValue && (
                  <input
                    className={`${inputClass} min-w-[90px]`}
                    value={valueText}
                    placeholder={t('placeholder-expression-values')}
                    onChange={e =>
                      setDrafts(prev => ({ ...prev, [row.id]: e.target.value }))
                    }
                    onBlur={() => {
                      const parsed = valueText
                        .split(',')
                        .map(v => v.trim())
                        .filter(Boolean);
                      const unique = parsed.filter((v, i) => parsed.indexOf(v) === i);
                      commit(data.map(r => (r.id === row.id ? { ...r, values: unique } : r)));
                    }}
                  />
                )}
                <button
                  className={`${BTN_ROW_REMOVE} mt-0.5 shrink-0`}
                  onClick={() => commit(data.filter(r => r.id !== row.id))}
                >
                  <X size={14} />
                </button>
                {keyError && (
                  <div className="w-full text-[10px] text-arrow-deny">{tr(t, keyError)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={() =>
          commit([
            ...data,
            { id: generateId(), key: '', operator: 'In', values: [] },
          ])
        }
        className={BTN_ADD}
      >
        <Plus size={12} /> {t('action-add-expression')}
      </button>
    </div>
  );
}
