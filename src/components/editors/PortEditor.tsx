import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Plus, X } from 'lucide-react';
import { generateId } from '@/lib/utils';
import { validatePort } from '@/lib/validators';
import { tr, useTranslation, type Msg, type TFunc } from '@/i18n';
import type { PortRule, Protocol } from '@/types/policy';
import { BTN_ADD, BTN_ROW_REMOVE } from '../ui/button';

interface PortRow extends PortRule {
  id: string;
}

interface PortEditorProps {
  ports: PortRule[];
  onChange: (ports: PortRule[]) => void;
}

interface TableMeta {
  updateData: (rowIndex: number, columnId: string, value: string) => void;
  removeRow: (rowIndex: number) => void;
}

const PROTOCOLS: Protocol[] = ['TCP', 'UDP', 'SCTP'];

/**
 * Columns are built per locale: `t` is stable per language, so `useMemo(..., [t])`
 * only rebuilds them on a language switch. Rebuilding every render would
 * re-register the cells' hooks and lose focus.
 */
function buildColumns(t: TFunc): ColumnDef<PortRow, unknown>[] {
  return [
    {
      accessorKey: 'port',
      header: t('header-port'),
      cell: ({ getValue, row, column, table }) => {
        const initialValue = String(getValue() ?? '');
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
              placeholder={t('placeholder-port')}
              onChange={e => {
                setValue(e.target.value);
                setError(null);
              }}
              onBlur={() => {
                const err = value.trim() ? validatePort(value.trim()) : null;
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
      accessorKey: 'protocol',
      header: t('header-protocol'),
      cell: ({ getValue, row, column, table }) => {
        const value = getValue() as string;
        return (
          <select
            className="w-full bg-transparent border border-card-border rounded px-1 py-1 text-xs focus:outline-none focus:border-accent"
            value={value}
            onChange={e =>
              (table.options.meta as TableMeta).updateData(row.index, column.id, e.target.value)
            }
          >
            {PROTOCOLS.map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
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

function toPortRules(rows: PortRow[]): PortRule[] {
  return rows.map(row => ({
    port: typeof row.port === 'string' && /^\d+$/.test(row.port) ? Number(row.port) : row.port,
    protocol: row.protocol,
  }));
}

export function PortEditor({ ports, onChange }: PortEditorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<PortRow[]>(() =>
    ports.map(p => ({ ...p, id: generateId() })),
  );

  const columns = useMemo(() => buildColumns(t), [t]);

  useEffect(() => {
    setData(ports.map(p => ({ ...p, id: generateId() })));
  }, [ports]);

  const updateData = useCallback(
    (rowIndex: number, columnId: string, value: string) => {
      setData(prev => {
        const next = prev.map((row, i) =>
          i === rowIndex ? { ...row, [columnId]: value } : row,
        );
        onChange(toPortRules(next));
        return next;
      });
    },
    [onChange],
  );

  const removeRow = useCallback(
    (rowIndex: number) => {
      setData(prev => {
        const next = prev.filter((_, i) => i !== rowIndex);
        onChange(toPortRules(next));
        return next;
      });
    },
    [onChange],
  );

  const addRow = useCallback(() => {
    setData(prev => [
      ...prev,
      { id: generateId(), port: '', protocol: 'TCP' as Protocol },
    ]);
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
                {row.getVisibleCells().map((cell, i) => (
                  <td key={i} className="pr-1 py-0.5">
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
        <Plus size={12} /> {t('action-add-port')}
      </button>
    </div>
  );
}
