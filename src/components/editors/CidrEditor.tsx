import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Plus, X } from 'lucide-react';
import { generateId } from '@/lib/utils';
import { validateCidr } from '@/lib/validators';
import { tr, useTranslation, type Msg, type TFunc } from '@/i18n';
import { BTN_ADD, BTN_ROW_REMOVE } from '../ui/button';

interface CidrRow {
  id: string;
  cidr: string;
}

interface CidrEditorProps {
  cidrs: string[];
  onChange: (cidrs: string[]) => void;
  placeholder?: string;
}

interface TableMeta {
  updateData: (rowIndex: number, columnId: string, value: string) => void;
  removeRow: (rowIndex: number) => void;
}

/**
 * Columns are built per locale: `t` is stable per language, so `useMemo(..., [t])`
 * only rebuilds them on a language switch. Rebuilding every render would
 * re-register the cells' hooks and lose focus.
 */
function buildColumns(t: TFunc): ColumnDef<CidrRow, string>[] {
  return [
    {
      accessorKey: 'cidr',
      header: t('field-cidr'),
      cell: ({ getValue, row, column, table }) => {
        const initialValue = getValue();
        const [value, setValue] = useState(initialValue);
        const [error, setError] = useState<Msg | null>(null);
        useEffect(() => setValue(initialValue), [initialValue]);
        return (
          <div>
            <input
              className={`w-full bg-transparent border rounded px-2 py-1 text-xs focus:outline-none ${
                error ? 'border-arrow-deny' : 'border-card-border focus:border-accent'
              }`}
              value={value}
              placeholder={t('placeholder-cidr')}
              onChange={e => {
                setValue(e.target.value);
                setError(null);
              }}
              onBlur={() => {
                const err = value.trim() ? validateCidr(value.trim()) : null;
                setError(err);
                (table.options.meta as TableMeta).updateData(row.index, column.id, value);
              }}
            />
            {error && <div className="text-[10px] text-arrow-deny mt-0.5">{tr(t, error)}</div>}
          </div>
        );
      },
    },
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

export function CidrEditor({ cidrs, onChange, placeholder }: CidrEditorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<CidrRow[]>(() =>
    cidrs.map(cidr => ({ id: generateId(), cidr })),
  );

  const columns = useMemo(() => buildColumns(t), [t]);

  useEffect(() => {
    setData(cidrs.map(cidr => ({ id: generateId(), cidr })));
  }, [cidrs]);

  const updateData = useCallback(
    (rowIndex: number, _columnId: string, value: string) => {
      setData(prev => {
        const next = prev.map((row, i) =>
          i === rowIndex ? { ...row, cidr: value } : row,
        );
        onChange(next.map(r => r.cidr).filter(Boolean));
        return next;
      });
    },
    [onChange],
  );

  const removeRow = useCallback(
    (rowIndex: number) => {
      setData(prev => {
        const next = prev.filter((_, i) => i !== rowIndex);
        onChange(next.map(r => r.cidr).filter(Boolean));
        return next;
      });
    },
    [onChange],
  );

  const addRow = useCallback(() => {
    setData(prev => [...prev, { id: generateId(), cidr: '' }]);
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
              <tr key={row.id}>
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
        <Plus size={12} /> {placeholder ?? t('action-add-cidr')}
      </button>
    </div>
  );
}
