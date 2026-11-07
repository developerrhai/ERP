// Rule-set editor: inputs, named parameters (margins, rates), rate tables and result formulas, plus a
// "Try it" box that runs the SAVED draft through the server's RuleEngine (the same code that prices
// a document). Formula mistakes come back as plain sentences, never codes.
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { toUiError } from '../../lib/errors';
import {
  discard,
  evaluateRule,
  publish,
  saveRule,
  type RuleDefinition,
  type SettingsVersion,
} from '../../lib/settingsApi';

const EMPTY: RuleDefinition = { inputs: [], parameters: [], tables: [], outputs: [] };

const slug = (s: string): string =>
  s
    .replace(/[^A-Za-z0-9_ ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('')
    .slice(0, 40);

interface Props {
  pageId: string;
  row: SettingsVersion<RuleDefinition> | null;
  approvalRequired: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function RuleEditor({ pageId, row, approvalRequired, onClose, onDone }: Props) {
  const isNew = row === null;
  const [draft, setDraft] = useState<SettingsVersion<RuleDefinition> | null>(
    row && row.status === 'DRAFT' ? row : null,
  );
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [money, setMoney] = useState(row?.moneyAffecting ?? true);
  const [def, setDef] = useState<RuleDefinition>(row ? { ...EMPTY, ...row.content } : EMPTY);
  const [tablesText, setTablesText] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, string> | null>(null);

  const patch = (p: Partial<RuleDefinition>): void => setDef((d) => ({ ...d, ...p }));
  const fail = (err: unknown): void => {
    const e = toUiError(err);
    setError(e.fields.definition ?? e.message);
    setFields(e.fields);
  };

  const withTables = (): RuleDefinition => ({
    ...def,
    tables: def.tables.map((t, i) => {
      const text = tablesText[i];
      if (text === undefined) return t;
      return {
        ...t,
        rows: text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => l.split(',').map((c) => c.trim())),
      };
    }),
  });

  const save = async (): Promise<SettingsVersion<RuleDefinition> | null> => {
    setError('');
    setFields({});
    if (!code.trim()) {
      setFields({ code: 'Enter a code, for example quotation.' });
      return null;
    }
    if (!name.trim()) {
      setFields({ name: 'Enter a name.' });
      return null;
    }
    try {
      const saved = await saveRule(
        pageId,
        { code: code.trim(), name: name.trim(), moneyAffecting: money, definition: withTables() },
        draft?.version ?? 0,
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

  const onTry = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    const saved = await save();
    if (saved) {
      try {
        const res = await evaluateRule(pageId, { id: saved.id }, testInputs);
        setResult(res.outputs);
      } catch (err) {
        fail(err);
      }
    }
    setBusy(false);
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
        const res = await publish(pageId, 'rules', saved, reason.trim());
        setBusy(false);
        onDone(
          res.status === 'PENDING_APPROVAL'
            ? `Sent for approval (v${res.versionNo}). It goes live when approved.`
            : `Published v${res.versionNo}. The next document uses it.`,
        );
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
      await discard(pageId, 'rules', draft);
      onDone('Draft discarded.');
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  };

  const upd = (key: 'inputs' | 'parameters' | 'tables' | 'outputs', i: number, p: object): void =>
    patch({
      [key]: (def[key] as object[]).map((x, at) => (at === i ? { ...x, ...p } : x)),
    } as Partial<RuleDefinition>);
  const del = (key: keyof RuleDefinition, i: number): void =>
    patch({ [key]: (def[key] as object[]).filter((_, at) => at !== i) } as Partial<RuleDefinition>);

  return (
    <Modal
      title={isNew ? 'New rule set' : `${row.name} — ${draft ? 'edit draft' : 'new version'}`}
      sub="Margins, rates and formulas. Nothing changes for users until you publish."
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
          label="Code *"
          value={code}
          disabled={!isNew}
          error={fields.code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Field
          label="Name *"
          value={name}
          error={fields.name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={money} onChange={(e) => setMoney(e.target.checked)} />
        This rule set changes money
        {money && approvalRequired ? ' (publishing needs approval)' : ''}
      </label>

      <h3>Inputs</h3>
      {def.inputs.map((x, i) => (
        <div className="grid-row" key={i}>
          <Field
            label="Name"
            value={x.name}
            onChange={(e) => upd('inputs', i, { name: e.target.value })}
          />
          <Field
            label="Default"
            value={x.default ?? ''}
            onChange={(e) => upd('inputs', i, { default: e.target.value })}
          />
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove input ${x.name}`}
            onClick={() => del('inputs', i)}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() => patch({ inputs: [...def.inputs, { name: '' }] })}
      >
        + Add input
      </button>

      <h3>Parameters (margins, rates, norms)</h3>
      {def.parameters.map((x, i) => (
        <div className="grid-row" key={i}>
          <Field
            label="Name"
            value={x.name}
            onChange={(e) => upd('parameters', i, { name: e.target.value })}
          />
          <Field
            label="Value"
            value={x.value}
            onChange={(e) => upd('parameters', i, { value: e.target.value })}
          />
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove parameter ${x.name}`}
            onClick={() => del('parameters', i)}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() => patch({ parameters: [...def.parameters, { name: '', value: '0' }] })}
      >
        + Add parameter
      </button>

      <h3>Rate tables</h3>
      {def.tables.map((t, i) => (
        <div className="card" key={i}>
          <Field
            label="Table name"
            value={t.name}
            onChange={(e) => upd('tables', i, { name: e.target.value })}
          />
          <Field
            label="Columns (comma separated; the first is the key)"
            value={t.columns.join(', ')}
            onChange={(e) =>
              upd('tables', i, {
                columns: e.target.value
                  .split(',')
                  .map((c) => c.trim())
                  .filter(Boolean),
              })
            }
          />
          <div className="field">
            <label htmlFor={`rows-${i}`}>Rows (one per line, comma separated)</label>
            <textarea
              id={`rows-${i}`}
              rows={4}
              value={tablesText[i] ?? t.rows.map((r) => r.join(', ')).join('\n')}
              onChange={(e) => setTablesText((x) => ({ ...x, [i]: e.target.value }))}
            />
          </div>
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove table ${t.name}`}
            onClick={() => del('tables', i)}
          >
            Remove table
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          patch({ tables: [...def.tables, { name: '', columns: ['Key', 'Value'], rows: [] }] })
        }
      >
        + Add rate table
      </button>

      <h3>Results (formulas)</h3>
      <p className="v8-sub">
        Use input and parameter names, + − × ÷, round(x, 2), min, max, if(…), lookup("table", key),
        slab("table", amount).
      </p>
      {def.outputs.map((x, i) => (
        <div className="grid-row" key={i}>
          <Field
            label="Name"
            value={x.name}
            onChange={(e) => upd('outputs', i, { name: e.target.value })}
          />
          <Field
            label="Formula"
            value={x.expression}
            onChange={(e) => upd('outputs', i, { expression: e.target.value })}
          />
          <button
            type="button"
            className="btn sm"
            aria-label={`Remove result ${x.name}`}
            onClick={() => del('outputs', i)}
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
            outputs: [
              ...def.outputs,
              { name: slug(`result${def.outputs.length + 1}`), expression: '', places: 2 },
            ],
          })
        }
      >
        + Add result
      </button>

      <h3>Try it</h3>
      <div className="grid-row">
        {def.inputs
          .filter((x) => x.name)
          .map((x) => (
            <Field
              key={x.name}
              label={x.label || x.name}
              value={testInputs[x.name] ?? ''}
              onChange={(e) => setTestInputs((t) => ({ ...t, [x.name]: e.target.value }))}
            />
          ))}
        <button type="button" className="btn sm" disabled={busy} onClick={() => void onTry()}>
          Save draft and test
        </button>
      </div>
      {result ? (
        <ul aria-label="Test result">
          {Object.entries(result).map(([k, v]) => (
            <li key={k}>
              {k}: <b>{v}</b>
            </li>
          ))}
        </ul>
      ) : null}

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
