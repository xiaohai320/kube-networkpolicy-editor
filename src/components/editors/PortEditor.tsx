import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table';
import { Plus, X } from 'lucide-react';
import { generateId } from '@/lib/utils';
import { validatePort } from '@/lib/validators';
import { tr, useTranslation, type Msg, type TFunc } from '@/i18n';
import type { HttpL7Rule, PortRule, Protocol } from '@/types/policy';
import { BTN_ADD, BTN_ROW_REMOVE } from '../ui/button';

interface PortRow extends PortRule {
  id: string;
}

interface PortEditorProps {
  ports: PortRule[];
  onChange: (ports: PortRule[]) => void;
}

/** A port row plus, when the port carries one, its HTTP filter row. */
function HttpRowGroup({
  row,
  cells,
  setHttp,
  t,
}: {
  row: Row<PortRow>;
  cells: React.ReactNode[];
  setHttp: (rowIndex: number, http?: HttpL7Rule) => void;
  t: TFunc;
}) {
  return (
    <>
      <tr key={row.id}>
        {cells.map((cell, i) => (
          <td key={i} className="pr-1 py-0.5">
            {cell}
          </td>
        ))}
      </tr>
      {row.original.http && (
        <HttpFilterRow
          http={row.original.http}
          onChange={http => setHttp(row.index, http)}
          onRemove={() => setHttp(row.index, undefined)}
          t={t}
        />
      )}
    </>
  );
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

import { HTTP_METHODS } from '@/types/policy';

/** One-row editor for the port's optional HTTP L7 filter (method + path). */
function HttpFilterRow({
  http,
  onChange,
  onRemove,
  t,
}: {
  http: HttpL7Rule;
  onChange: (http: HttpL7Rule) => void;
  onRemove: () => void;
  t: TFunc;
}) {
  // Local draft + commit on blur, mirroring the port cell: the parent's
  // effect resets row ids whenever the ports prop changes, so committing per
  // keystroke would remount this row and drop focus mid-word.
  const [method, setMethod] = useState(http.method ?? '');
  const [path, setPath] = useState(http.path ?? '');
  useEffect(() => {
    setMethod(http.method ?? '');
    setPath(http.path ?? '');
  }, [http]);
  const commit = (m: string, p: string) =>
    onChange({
      ...(m ? { method: m } : {}),
      ...(p ? { path: p } : {}),
    });
  return (
    <tr>
      <td colSpan={4} className="py-0.5">
        <div className="flex items-center gap-1 text-xs bg-canvas/40 rounded px-1 py-0.5">
          <span className="text-[10px] font-mono text-text-secondary">http</span>
          <select
            className="bg-transparent border border-card-border rounded px-1 py-0.5 text-xs"
            value={method}
            onChange={e => {
              setMethod(e.target.value);
              commit(e.target.value, path);
            }}
            aria-label={t('header-method')}
          >
            <option value="">—</option>
            {HTTP_METHODS.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            className="bg-transparent border border-card-border rounded px-1 py-0.5 text-xs flex-1 min-w-0 font-mono"
            value={path}
            placeholder="/path or /api/.*"
            onChange={e => setPath(e.target.value)}
            onBlur={() => commit(method, path)}
            aria-label={t('header-path')}
          />
          <button className={BTN_ROW_REMOVE} onClick={onRemove} aria-label={t('action-remove')}>
            <X size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function toPortRules(rows: PortRow[]): PortRule[] {
  return rows.map(row => {
    const http = row.http && (row.http.method || row.http.path) ? row.http : undefined;
    return {
      port: typeof row.port === 'string' && /^\d+$/.test(row.port) ? Number(row.port) : row.port,
      protocol: row.protocol,
      ...(http ? { http } : {}),
    };
  });
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

  const setHttp = useCallback(
    (rowIndex: number, http?: HttpL7Rule) => {
      setData(prev => {
        const next = prev.map((row, i) => (i === rowIndex ? { ...row, http } : row));
        onChange(toPortRules(next));
        return next;
      });
    },
    [onChange],
  );

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
              <HttpRowGroup
                key={row.id}
                row={row}
                cells={row.getVisibleCells().map(cell => flexRender(cell.column.columnDef.cell, cell.getContext()))}
                setHttp={setHttp}
                t={t}
              />
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
