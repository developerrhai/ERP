// apps/web/src/pages/generic/kit/LinesEditor.tsx
// Document line items editor with debounced server preview and optimistic locking (docs/plans/07-ENGINE-KIT.md §2.5, §12 T-KIT-09)

import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../../../components/ErrorMessage';
import { useToast } from '../../../components/Toast';
import { ApiError, api } from '../../../lib/api';
import type { PageSchema, RecordRow } from '../engineApi';
import { patchRecord } from '../engineApi';
import { LookupCombobox } from '../LookupCombobox';
import { formatValue } from './formatValue';
import type { Line, LineColumn, LineCtx } from './lineKinds';
import { getLineKind } from './lineKinds';

export interface LinesEditorProps {
  kind: string;
  record: RecordRow;
  schema: PageSchema;
  onSaved?: () => void;
}

interface LocalLine {
  _localKey: string;
  data: Line;
}

export function LinesEditor({ kind, record, schema, onSaved }: LinesEditorProps) {
  const toast = useToast();
  const idGen = useRef(0);
  const nextKey = () => `line_${++idGen.current}`;

  const spec = getLineKind(kind);
  const ctx: LineCtx = { pageId: schema.pageId, record, schema };

  // Parse initial lines from record.data.lines or record.lines
  const initialDataLines = (record.data?.lines ?? (record as unknown as Record<string, unknown>).lines ?? []) as Line[];
  const [lines, setLines] = useState<LocalLine[]>(() =>
    initialDataLines.map((l) => ({ _localKey: nextKey(), data: { ...l } })),
  );

  const [totals, setTotals] = useState<Record<string, number>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [staleVersion, setStaleVersion] = useState(false);

  const isEditable = spec ? spec.isEditable(record.status) : false;
  const previewSeq = useRef(0);

  // Debounced server preview (400ms) with request cancellation (latest wins)
  useEffect(() => {
    if (!spec?.preview) return;

    const seq = ++previewSeq.current;
    const timer = setTimeout(async () => {
      try {
        const rawLines = lines.map((l) => l.data);
        const path = spec.preview!.path(ctx);
        const body = spec.preview!.body(rawLines, ctx);

        const res = await api<{ totals?: Record<string, number>; lines?: Line[] }>(path, {
          method: 'POST',
          body,
        });

        if (seq !== previewSeq.current) return;
        setPreviewError(null);
        if (res?.totals) {
          setTotals(res.totals);
        }
        if (res?.lines && Array.isArray(res.lines)) {
          // Merge server-calculated line values (rates, taxes, etc.) without losing local identities
          setLines((prev) =>
            prev.map((pl, idx) => {
              const serverLine = res.lines![idx];
              return serverLine ? { ...pl, data: { ...pl.data, ...serverLine } } : pl;
            }),
          );
        }
      } catch (err: unknown) {
        if (seq !== previewSeq.current) return;
        if (err instanceof ApiError) {
          setPreviewError(err.message);
        } else {
          setPreviewError('Failed to preview totals.');
        }
        setTotals({});
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [lines, spec, ctx.pageId, record.id]);

  const updateCell = useCallback(
    (idx: number, key: string, val: unknown) => {
      setLines((prev) => {
        const next = [...prev];
        const current = next[idx];
        if (!current) return prev;
        next[idx] = {
          ...current,
          data: { ...current.data, [key]: val },
        };
        return next;
      });
      // Clear field error for this cell
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy[`lines[${idx}].${key}`];
        delete copy[`${idx}.${key}`];
        return copy;
      });
    },
    [],
  );

  const handlePick = useCallback(
    async (idx: number, col: LineColumn, item: { id: string; code: string; name: string } | null) => {
      if (!item) {
        updateCell(idx, col.key, null);
        return;
      }
      updateCell(idx, col.key, item.id);

      if (spec?.onPick) {
        try {
          const currentLine = lines[idx]?.data ?? {};
          const partial = await spec.onPick(col.key, item, currentLine, ctx);
          if (partial) {
            setLines((prev) => {
              const next = [...prev];
              const cur = next[idx];
              if (!cur) return prev;
              next[idx] = {
                ...cur,
                data: { ...cur.data, ...partial },
              };
              return next;
            });
          }
        } catch {
          // Ignore pick error
        }
      }
    },
    [spec, lines, ctx, updateCell],
  );

  const addRow = () => {
    if (!spec) return;
    const defaultData = spec.newLine(ctx);
    setLines((prev) => [...prev, { _localKey: nextKey(), data: defaultData }]);
  };

  const removeRow = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    setFieldErrors({});
    setStaleVersion(false);

    try {
      const rawLines = lines.map((l) => l.data);
      await patchRecord(schema.pageId, record, { lines: rawLines });
      toast('Lines saved successfully.');
      onSaved?.();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setStaleVersion(true);
          toast(err.message ?? 'Document was modified by another session. Keep changes or reload.');
        } else if (err.status === 422 && err.fields) {
          setFieldErrors(err.fields);
          toast('Please correct the highlighted line errors.');
        } else {
          toast(err.message ?? 'Failed to save lines.');
        }
      } else {
        toast('Failed to save lines.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!spec) {
    return (
      <div className="v9-section lines-editor">
        <ErrorMessage>Unknown line kind &quot;{kind}&quot;.</ErrorMessage>
      </div>
    );
  }

  return (
    <div className="v9-section lines-editor">
      <div
        className="lines-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h3 style={{ margin: 0 }}>Document Lines</h3>
          {!isEditable ? (
            <span
              className="badge"
              title="Only a Draft can be edited"
              style={{ fontSize: '10px', background: 'var(--card2)', color: 'var(--muted)', padding: '2px 8px', borderRadius: '6px' }}
            >
              Only a Draft can be edited
            </span>
          ) : null}
        </div>
        {isEditable ? (
          <div className="actions" style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn small"
              onClick={addRow}
              disabled={saving}
            >
              ＋ Add row
            </button>
            <button
              type="button"
              className="btn small primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save lines'}
            </button>
          </div>
        ) : null}
      </div>

      {previewError ? <ErrorMessage>{previewError}</ErrorMessage> : null}
      {staleVersion ? (
        <div
          className="notice bad"
          role="alert"
          style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b', fontSize: '11px' }}
        >
          Version conflict: This record has been updated elsewhere. Your changes are preserved in the grid. Reload to refresh.
        </div>
      ) : null}

      <div className="table-wrap v9-line-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>#</th>
              {spec.columns.map((col) => (
                <th key={col.key} style={{ width: col.width }}>
                  {col.label}
                </th>
              ))}
              {isEditable ? <th style={{ width: '50px', textAlign: 'center' }}>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={spec.columns.length + (isEditable ? 2 : 1)}
                  style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}
                >
                  No lines added.
                </td>
              </tr>
            ) : (
              lines.map((l, rIdx) => {
                return (
                  <tr key={l._localKey}>
                    <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '10px' }}>
                      {rIdx + 1}
                    </td>
                    {spec.columns.map((col) => {
                      const canEdit =
                        isEditable &&
                        (col.editableWhen ? col.editableWhen(l.data, ctx) : col.type !== 'readonly');
                      const cellErr =
                        fieldErrors[`lines[${rIdx}].${col.key}`] ?? fieldErrors[`${rIdx}.${col.key}`];
                      const val = l.data[col.key];

                      return (
                        <td key={col.key} style={{ verticalAlign: 'top' }}>
                          {!canEdit ? (
                            <span style={{ fontSize: '11px' }}>
                              {formatValue(val, col.format ?? (col.type === 'money' ? 'money' : col.type === 'qty' ? 'qty' : 'text'))}
                            </span>
                          ) : col.type === 'lookup' && col.lookup ? (
                            <div>
                              <LookupCombobox
                                label=""
                                kind={col.lookup}
                                value={String(val ?? '')}
                                onChange={(_id, item) => void handlePick(rIdx, col, item)}
                              />
                              {cellErr ? (
                                <small
                                  className="field-error"
                                  role="alert"
                                  style={{ color: '#dc2626', fontSize: '9px', display: 'block' }}
                                >
                                  {cellErr}
                                </small>
                              ) : null}
                            </div>
                          ) : col.type === 'select' && col.options ? (
                            <div>
                              <select
                                value={String(val ?? '')}
                                onChange={(e) => updateCell(rIdx, col.key, e.target.value)}
                              >
                                <option value="">Select…</option>
                                {col.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                              {cellErr ? (
                                <small
                                  className="field-error"
                                  role="alert"
                                  style={{ color: '#dc2626', fontSize: '9px', display: 'block' }}
                                >
                                  {cellErr}
                                </small>
                              ) : null}
                            </div>
                          ) : (
                            <div>
                              <input
                                type={
                                  col.type === 'qty' || col.type === 'money' || col.type === 'pct'
                                    ? 'number'
                                    : col.type === 'date'
                                      ? 'date'
                                      : 'text'
                                }
                                value={val !== undefined && val !== null ? String(val) : ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const parsed =
                                    col.type === 'qty' || col.type === 'money' || col.type === 'pct'
                                      ? raw === ''
                                        ? ''
                                        : Number(raw)
                                      : raw;
                                  updateCell(rIdx, col.key, parsed);
                                }}
                              />
                              {cellErr ? (
                                <small
                                  className="field-error"
                                  role="alert"
                                  style={{ color: '#dc2626', fontSize: '9px', display: 'block' }}
                                >
                                  {cellErr}
                                </small>
                              ) : null}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {isEditable ? (
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() => removeRow(rIdx)}
                          title="Remove line"
                        >
                          ✕
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {spec.totalsLabels && spec.totalsLabels.length > 0 ? (
        <div className="v9-total" role="region" aria-label="Line totals">
          {spec.totalsLabels.map((tl) => (
            <div key={tl.key} style={{ textAlign: 'right' }}>
              <span className="muted" style={{ display: 'block', fontSize: '10px' }}>
                {tl.label}
              </span>
              <b>{formatValue(totals[tl.key] ?? 0, tl.format)}</b>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
