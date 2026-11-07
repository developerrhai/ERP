// Format editor: header fields, line columns, totals and print layout, with a live preview that is
// drawn from the same JSON the server stores. "Save draft" keeps working copies; "Publish new
// version" asks for a reason and makes the format live for every screen and print that reads it.
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { toUiError } from '../../lib/errors';
import { listCustomers } from '../../lib/mastersApi';
import {
  discard,
  publish,
  saveFormat,
  type FormatColumn,
  type FormatField,
  type FormatSchema,
  type FormatTotal,
  type SettingsKind,
  type SettingsVersion,
} from '../../lib/settingsApi';
import { useLoad } from '../../lib/useLoad';
import { listUnits } from '../admin/orgApi';

const FIELD_TYPES = ['text', 'number', 'money', 'percent', 'date', 'select', 'textarea'] as const;
const COLUMN_TYPES = ['text', 'number', 'money', 'percent', 'date'] as const;

export const EMPTY_FORMAT: FormatSchema = {
  header: [],
  columns: [],
  totals: [],
  print: {
    paper: 'A4',
    orientation: 'portrait',
    showLetterhead: true,
    showAmountInWords: true,
    signatures: [],
  },
  validations: [],
};

const keyOf = (label: string): string => {
  const words = label
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const k = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
  return /^[A-Za-z]/.test(k) ? k.slice(0, 40) : `f${k}`.slice(0, 40);
};

interface Props {
  pageId: string;
  row: SettingsVersion<FormatSchema> | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function FormatEditor({ pageId, row, onClose, onDone }: Props) {
  const isNew = row === null;
  const [draft, setDraft] = useState<SettingsVersion<FormatSchema> | null>(
    row && row.status === 'DRAFT' ? row : null,
  );
  const [name, setName] = useState(row?.name ?? '');
  const [kind, setKind] = useState<SettingsKind>(row?.kind ?? 'FORM');
  const [customerId, setCustomerId] = useState(row?.customer?.id ?? '');
  const [unitId, setUnitId] = useState(row?.unit?.id ?? '');
  const [schema, setSchema] = useState<FormatSchema>(
    row ? { ...EMPTY_FORMAT, ...row.content } : EMPTY_FORMAT,
  );
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const customers = useLoad(() => listCustomers({ size: 100 }), []);
  const units = useLoad(listUnits, []);

  const patch = (p: Partial<FormatSchema>): void => setSchema((s) => ({ ...s, ...p }));
  const patchPrint = (p: Partial<FormatSchema['print']>): void =>
    setSchema((s) => ({ ...s, print: { ...s.print, ...p } }));

  const fail = (err: unknown): void => {
    const e = toUiError(err);
    setError(e.fields.schema ?? e.message);
    setFields(e.fields);
  };

  const rowVersion = draft?.version ?? 0;
  const save = async (): Promise<SettingsVersion<FormatSchema> | null> => {
    setError('');
    setFields({});
    if (!name.trim()) {
      setFields({ name: 'Enter a name.' });
      return null;
    }
    try {
      const saved = await saveFormat(
        pageId,
        { kind, customerId: customerId || null, unitId: unitId || null },
        name.trim(),
        schema,
        rowVersion,
      );
      setDraft(saved);
      return saved;
    } catch (err) {
      fail(err);
      return null;
    }
  };

  const onSave = async (): Promise<void> => {
    setBusy(true);
    const saved = await save();
    setBusy(false);
    if (saved) onDone(`Draft saved (v${saved.versionNo}).`);
  };

  const onPublish = async (): Promise<void> => {
    if (reason.trim().length < 3) {
      setFields({ reason: 'Give a short reason (at least 3 characters).' });
      return;
    }
    setBusy(true);
    const saved = await save();
    if (saved) {
      try {
        const live = await publish(pageId, 'formats', saved, reason.trim());
        setBusy(false);
        onDone(`Published v${live.versionNo}. Every screen now uses it.`);
        return;
      } catch (err) {
        fail(err);
      }
    }
    setBusy(false);
  };

  const onDiscard = async (): Promise<void> => {
    if (!draft) return;
    setBusy(true);
    try {
      await discard(pageId, 'formats', draft);
      onDone('Draft discarded.');
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  };

  const updateAt = <T,>(list: T[], i: number, p: Partial<T>): T[] =>
    list.map((x, at) => (at === i ? { ...x, ...p } : x));

  return (
    <Modal
      title={isNew ? 'New format' : `${row.name} — ${draft ? 'edit draft' : 'new version'}`}
      sub="Fields, columns, totals and print layout. Nothing changes for users until you publish."
      onClose={onClose}
      footer={
        <>
          {draft ? (
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => void onDiscard()}
            >
              Discard draft
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void onSave()}>
            Save draft
          </button>
          {asking ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void onPublish()}
            >
              Confirm publish
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => setAsking(true)}
            >
              Publish new version
            </button>
          )}
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <div className="grid-2">
        <Field
          label="Name *"
          value={name}
          error={fields.name}
          onChange={(e) => setName(e.target.value)}
        />
        <SelectField
          label="Used for"
          value={kind}
          disabled={!isNew}
          onChange={(v) => setKind(v as SettingsKind)}
        >
          <option value="FORM">Data-entry form</option>
          <option value="PRINT">Print layout</option>
          <option value="REPORT">Report</option>
        </SelectField>
        <SelectField label="Customer" value={customerId} disabled={!isNew} onChange={setCustomerId}>
          <option value="">All customers</option>
          {customers.data?.rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Unit" value={unitId} disabled={!isNew} onChange={setUnitId}>
          <option value="">All units</option>
          {units.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      </div>
      <Field
        label="Title on the document"
        value={schema.title ?? ''}
        onChange={(e) => patch({ title: e.target.value })}
      />

      <h3>Header fields</h3>
      {schema.header.map((f, i) => (
        <div className="grid-row" key={i}>
          <Field
            label="Label"
            value={f.label}
            onChange={(e) =>
              patch({
                header: updateAt<FormatField>(schema.header, i, {
                  label: e.target.value,
                  key: f.key || keyOf(e.target.value),
                }),
              })
            }
          />
          <SelectField
            label="Type"
            value={f.type}
            onChange={(v) =>
              patch({
                header: updateAt<FormatField>(schema.header, i, { type: v as FormatField['type'] }),
              })
            }
          >
            {FIELD_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectField>
          <label className="check">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) =>
                patch({
                  header: updateAt<FormatField>(schema.header, i, { required: e.target.checked }),
                })
              }
            />
            Required
          </label>
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove field ${f.label}`}
            onClick={() => patch({ header: schema.header.filter((_, at) => at !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          patch({
            header: [
              ...schema.header,
              { key: `field${schema.header.length + 1}`, label: '', type: 'text', required: false },
            ],
          })
        }
      >
        + Add field
      </button>

      <h3>Line columns</h3>
      {schema.columns.map((c, i) => (
        <div className="grid-row" key={i}>
          <Field
            label="Label"
            value={c.label}
            onChange={(e) =>
              patch({
                columns: updateAt<FormatColumn>(schema.columns, i, {
                  label: e.target.value,
                  key: c.key || keyOf(e.target.value),
                }),
              })
            }
          />
          <SelectField
            label="Type"
            value={c.type}
            onChange={(v) =>
              patch({
                columns: updateAt<FormatColumn>(schema.columns, i, {
                  type: v as FormatColumn['type'],
                }),
              })
            }
          >
            {COLUMN_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </SelectField>
          <Field
            label="Formula (optional)"
            value={c.formula ?? ''}
            placeholder="qty * rate"
            onChange={(e) => {
              const { formula: _drop, ...rest } = c;
              void _drop;
              patch({
                columns: schema.columns.map((x, at) =>
                  at === i ? (e.target.value ? { ...rest, formula: e.target.value } : rest) : x,
                ),
              });
            }}
          />
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove column ${c.label}`}
            onClick={() => patch({ columns: schema.columns.filter((_, at) => at !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          patch({
            columns: [
              ...schema.columns,
              {
                key: `col${schema.columns.length + 1}`,
                label: '',
                type: 'text',
                required: false,
                hidden: false,
              },
            ],
          })
        }
      >
        + Add column
      </button>

      <h3>Totals</h3>
      {schema.totals.map((t, i) => (
        <div className="grid-row" key={i}>
          <Field
            label="Label"
            value={t.label}
            onChange={(e) =>
              patch({
                totals: updateAt<FormatTotal>(schema.totals, i, {
                  label: e.target.value,
                  key: t.key || keyOf(e.target.value),
                }),
              })
            }
          />
          <SelectField
            label="Add up column"
            value={t.column ?? ''}
            onChange={(v) =>
              patch({ totals: updateAt<FormatTotal>(schema.totals, i, { column: v, op: 'sum' }) })
            }
          >
            <option value="">Choose…</option>
            {schema.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label || c.key}
              </option>
            ))}
          </SelectField>
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove total ${t.label}`}
            onClick={() => patch({ totals: schema.totals.filter((_, at) => at !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          patch({
            totals: [
              ...schema.totals,
              { key: `total${schema.totals.length + 1}`, label: '', op: 'sum' },
            ],
          })
        }
      >
        + Add total
      </button>

      <h3>Print layout</h3>
      <div className="grid-2">
        <SelectField
          label="Paper"
          value={schema.print.paper}
          onChange={(v) => patchPrint({ paper: v as 'A4' | 'A5' })}
        >
          <option>A4</option>
          <option>A5</option>
        </SelectField>
        <SelectField
          label="Orientation"
          value={schema.print.orientation}
          onChange={(v) => patchPrint({ orientation: v as 'portrait' | 'landscape' })}
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </SelectField>
      </div>
      <Field
        label="Signature boxes (comma separated)"
        value={schema.print.signatures.join(', ')}
        onChange={(e) =>
          patchPrint({
            signatures: e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
      <Field
        label="Footer note"
        value={schema.print.footerNote ?? ''}
        onChange={(e) => patchPrint({ footerNote: e.target.value })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={schema.print.showLetterhead}
          onChange={(e) => patchPrint({ showLetterhead: e.target.checked })}
        />
        Show the company letterhead
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={schema.print.showAmountInWords}
          onChange={(e) => patchPrint({ showAmountInWords: e.target.checked })}
        />
        Show the amount in words
      </label>

      <h3>Live preview</h3>
      <div className="card format-preview" aria-label="Preview">
        <b>{schema.title || name || 'Untitled'}</b>
        <div className="preview-header">
          {schema.header.map((f, i) => (
            <label key={i}>
              {f.label || 'Field'}
              {f.required ? ' *' : ''}
              <input disabled aria-label={`Preview ${f.label || 'field'}`} />
            </label>
          ))}
        </div>
        {schema.columns.length > 0 ? (
          <table>
            <thead>
              <tr>
                {schema.columns
                  .filter((c) => !c.hidden)
                  .map((c, i) => (
                    <th key={i} scope="col">
                      {c.label || 'Column'}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {schema.columns
                  .filter((c) => !c.hidden)
                  .map((c, i) => (
                    <td key={i}>{c.type === 'money' ? '₹ 0.00' : '—'}</td>
                  ))}
              </tr>
            </tbody>
          </table>
        ) : null}
        {schema.totals.map((t, i) => (
          <div key={i}>{t.label || 'Total'}: ₹ 0.00</div>
        ))}
        <small>
          {schema.print.paper} {schema.print.orientation}
          {schema.print.signatures.length > 0
            ? ` · Sign: ${schema.print.signatures.join(' / ')}`
            : ''}
        </small>
      </div>

      {asking ? (
        <Field
          label="Reason for this change *"
          value={reason}
          error={fields.reason}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
    </Modal>
  );
}
