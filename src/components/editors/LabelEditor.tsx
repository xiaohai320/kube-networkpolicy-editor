import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Plus, X } from 'lucide-react';
import { generateId } from '@/lib/utils';
import { validateLabelKey, validateLabelValue } from '@/lib/validators';
import { tr, useTranslation, type Msg, type TFunc } from '@/i18n';
import { BTN_ADD, BTN_ROW_REMOVE } from '../ui/button';

interface LabelRow {
  id: string;
  key: string;
  value: string;
}

interface LabelEditorProps {
  labels: Record<string, string>;
  onChange: (labels: Record<string, string>) => void;
}

function toRows(labels: Record<string, string>): LabelRow[] {
  return Object.entries(labels).map(([key, value]) => ({
    id: generateId(),
    key,
    value,
  }));
}

function toRecord(rows: LabelRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key) {
      result[row.key] = row.value;
    }
  }
  return result;
}

interface TableMeta {
  updateData: (rowIndex: number, columnId: string, value: string) => void;
  removeRow: (rowIndex: number) => void;
}

function inputClass(error: Msg | null): string {
  return `w-full bg-transparent border rounded px-2 py-1 text-xs focus:outline-none ${
    error ? 'border-arrow-deny' : 'border-card-border focus:border-accent'
  }`;
}

/**
 * Columns are built per locale rather than at module scope: `t` is stable per
 * language, so `useMemo(..., [t])` only rebuilds them on a language switch.
 * Rebuilding on every render would re-register the cells' hooks and lose focus.
 */
function buildColumns(t: TFunc): ColumnDef<LabelRow, string>[] {
  const textColumn = (
    accessorKey: 'key' | 'value',
    headerKey: string,
    placeholderKey: string,
    validate: (text: string) => Msg | null,
  ): ColumnDef<LabelRow, string> => ({
    accessorKey,
    header: t(headerKey),
    cell: ({ getValue, row, column, table }) => {
      const initialValue = getValue();
      const [value, setValue] = useState(initialValue);
      const [error, setError] = useState<Msg | null>(null);
      useEffect(() => setValue(initialValue), [initialValue]);
      return (
        <div>
          <input
            className={inputClass(error)}
            value={value}
            placeholder={t(placeholderKey)}
            onChange={e => {
              setValue(e.target.value);
              setError(null);
            }}
            onBlur={() => {
              const err = value.trim() ? validate(value.trim()) : null;
              setError(err);
              (table.options.meta as TableMeta).updateData(row.index, column.id, value);
            }}
          />
          {error && <div className="text-[10px] text-arrow-deny mt-0.5">{tr(t, error)}</div>}
        </div>
      );
    },
  });

  return [
    textColumn('key', 'header-key', 'placeholder-label-key', validateLabelKey),
    textColumn('value', 'header-value', 'placeholder-label-value', validateLabelValue),
    {
      id: 'actions',
      header: '',
      size: 32,
      cell: ({ row, table }) => (
        <button
          className={BTN_ROW_REMOVE}
          onClick={() => (table.options.meta as TableMeta).removeRow(row.index)}
        >
          <X size={14} />
        </button>
      ),
    },
  ];
}

export function LabelEditor({ labels, onChange }: LabelEditorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<LabelRow[]>(() => toRows(labels));

  const columns = useMemo(() => buildColumns(t), [t]);

  useEffect(() => {
    setData(toRows(labels));
  }, [labels]);

  const updateData = useCallback(
    (rowIndex: number, columnId: string, value: string) => {
      setData(prev => {
        const next = prev.map((row, i) =>
          i === rowIndex ? { ...row, [columnId]: value } : row,
        );
        onChange(toRecord(next));
        return next;
      });
    },
    [onChange],
  );

  const removeRow = useCallback(
    (rowIndex: number) => {
      setData(prev => {
        const next = prev.filter((_, i) => i !== rowIndex);
        onChange(toRecord(next));
        return next;
      });
    },
    [onChange],
  );

  const addRow = useCallback(() => {
    setData(prev => [...prev, { id: generateId(), key: '', value: '' }]);
  }, []);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.id,
    meta: { updateData, removeRow } satisfies TableMeta,
  });

  return (
    <div className="space-y-1">
      {table.getRowModel().rows.length > 0 && (
        <table className="w-full">
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="gap-1">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="pr-1 py-0.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        onClick={addRow}
        className={BTN_ADD}
      >
        <Plus size={12} /> {t('action-add-label')}
      </button>
    </div>
  );
}
