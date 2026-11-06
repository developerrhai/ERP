// Approval Matrix (admin-approval): the matrix EDITOR, not a list of requests. Filters (Department,
// Document type, Unit), the Department | Document | Unit | Level | Threshold | Approver | SLA |
// Escalate to table, one dialog per rule set with inline errors, and a "Test an amount" box.
// Read-only for users without "controls". An "Approval Center" button opens /approvals.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import {
  deleteRuleSet,
  inr,
  listMatrix,
  previewMatrix,
  saveRuleSet,
  type LevelInput,
  type PreviewResult,
  type RuleSet,
} from '../../lib/approvalsApi';
import { toUiError } from '../../lib/errors';
import { registry } from '../../lib/registry';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet, RoleInfo } from '../../types';
import { activeDepartmentNames, listRoles } from '../admin/adminApi';
import { listUnits } from '../admin/orgApi';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; set: RuleSet }
  | { kind: 'delete'; set: RuleSet }
  | null;

const DOC_OPTIONS = registry.families
  .filter((f) => f.name !== 'Administration')
  .flatMap((f) => f.items.map((i) => ({ id: i.id, title: i.title, family: f.name })));

export function ApprovalMatrixPage({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [department, setDepartment] = useState('');
  const [docType, setDocType] = useState('');
  const [unit, setUnit] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const sets = useLoad(
    () =>
      listMatrix({
        ...(department ? { department } : {}),
        ...(docType ? { docType } : {}),
        ...(unit ? { unit } : {}),
      }),
    [department, docType, unit],
  );
  const depts = useLoad(activeDepartmentNames, []);
  const units = useLoad(listUnits, []);
  const roles = useLoad(listRoles, []);
  const canEdit = actions.controls === true;
  const close = (): void => setDialog(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approval Matrix</h1>
          <p>Who approves what: by department, document, unit and amount.</p>
        </div>
        <div className="actions">
          <Link className="btn" to="/approvals">
            Approval Center
          </Link>
          {canEdit ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setDialog({ kind: 'add' })}
            >
              ＋ Add Rule Set
            </button>
          ) : null}
        </div>
      </div>
      {!canEdit ? (
        <div className="notice" role="note">
          You can view the matrix. Only users with the Controls right can change it.
        </div>
      ) : null}
      <div className="recordbar">
        <select
          aria-label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">All departments</option>
          {(depts.data ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          aria-label="Document type"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
        >
          <option value="">Any document type</option>
          <option value="ALL">All documents (default sets)</option>
          {DOC_OPTIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">Any unit</option>
          <option value="ALL">All units</option>
          {(units.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {sets.error ? <ErrorMessage onReload={sets.reload}>{sets.error}</ErrorMessage> : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col">Document</th>
              <th scope="col">Unit</th>
              <th scope="col">Level</th>
              <th scope="col">Threshold (₹)</th>
              <th scope="col">Approver</th>
              <th scope="col">SLA (h)</th>
              <th scope="col">Escalate to</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(sets.data ?? []).flatMap((s) =>
              s.levels.map((l, i) => (
                <tr key={`${s.id}-${l.level}`} className={i === 0 ? 'set-start' : undefined}>
                  <td>{i === 0 ? <strong>{s.department}</strong> : ''}</td>
                  <td>{i === 0 ? (s.docTitle ?? 'All documents') : ''}</td>
                  <td>{i === 0 ? (s.unitCode ?? 'All units') : ''}</td>
                  <td>L{l.level}</td>
                  <td>{inr(l.threshold)}</td>
                  <td>{l.approverRoleName ?? l.approverUserName ?? '—'}</td>
                  <td>{l.slaHours}</td>
                  <td>{l.escalateRoleName ?? l.escalateUserName ?? '—'}</td>
                  <td>
                    {i === 0 && canEdit ? (
                      <div className="actions">
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`Edit set ${s.department} ${s.docTitle ?? 'All documents'}`}
                          onClick={() => setDialog({ kind: 'edit', set: s })}
                        >
                          Edit set
                        </button>
                        {!s.isDefault ? (
                          <button
                            type="button"
                            className="btn sm danger"
                            aria-label={`Delete set ${s.department} ${s.docTitle ?? ''}`}
                            onClick={() => setDialog({ kind: 'delete', set: s })}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              )),
            )}
            {sets.loading && !sets.data ? (
              <tr className="empty-row">
                <td colSpan={9}>Loading…</td>
              </tr>
            ) : null}
            {sets.data && sets.data.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={9}>
                  No rule sets match. {canEdit ? 'Click ＋ Add Rule Set to create one.' : ''}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <TestAmount departments={depts.data ?? []} />
      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <SetDialog
          {...(dialog.kind === 'edit' ? { set: dialog.set } : {})}
          departments={depts.data ?? []}
          units={(units.data ?? []).map((u) => ({ id: u.id, name: u.name }))}
          roles={roles.data ?? []}
          onClose={close}
          onSaved={(name) => {
            close();
            sets.reload();
            toast(`Rule set for ${name} saved.`);
          }}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteDialog
          set={dialog.set}
          onClose={close}
          onDeleted={() => {
            close();
            sets.reload();
            toast('Rule set deleted.');
          }}
        />
      ) : null}
    </>
  );
}

function TestAmount({ departments }: { departments: string[] }) {
  const [department, setDepartment] = useState('');
  const [docType, setDocType] = useState('');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState('');
  const run = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!department) {
      setError('Choose a department.');
      return;
    }
    setError('');
    try {
      setResult(
        await previewMatrix({
          department,
          ...(docType ? { docType } : {}),
          amount: amount.trim() === '' ? null : Number(amount),
        }),
      );
    } catch (err) {
      setError(toUiError(err).message);
      setResult(null);
    }
  };
  return (
    <form
      className="card panel test-amount"
      onSubmit={(e) => void run(e)}
      aria-label="Test an amount"
    >
      <h3>Test an amount</h3>
      <p className="v8-sub">See which levels apply and who would approve. Nothing is saved.</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ta-dept">Department</label>
          <select id="ta-dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Choose…</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ta-doc">Document</label>
          <select id="ta-doc" value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">Any document</option>
            {DOC_OPTIONS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ta-amount">Amount (₹, empty = no amount)</label>
          <input
            id="ta-amount"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
      <button type="submit" className="btn">
        Test
      </button>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {result ? (
        result.levels.length === 0 ? (
          <p className="v8-sub" role="status">
            No rules are set for {result.department}.
          </p>
        ) : (
          <ol className="journey-steps" aria-label="Levels that apply">
            {result.levels.map((l) => (
              <li key={l.level} className="journey-step">
                <b>
                  Level {l.level} · {l.approver} (from {inr(l.threshold)}, SLA {l.slaHours} h)
                </b>
                <div className="v8-sub">
                  {l.approvers.length > 0
                    ? l.approvers
                        .map((a) => `${a.name}${a.limit ? ` (limit ${inr(a.limit)})` : ''}`)
                        .join(', ')
                    : 'Nobody can approve this level yet.'}
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </form>
  );
}

interface Row {
  key: number;
  threshold: string;
  approver: string; // "role:<id>" | "user:<id>"
  userName: string;
  sla: string;
  escalate: string; // "role:<id>" | ""
}

const blankRow = (key: number, threshold = ''): Row => ({
  key,
  threshold,
  approver: '',
  userName: '',
  sla: '48',
  escalate: '',
});

function SetDialog({
  set,
  departments,
  units,
  roles,
  onClose,
  onSaved,
}: {
  set?: RuleSet;
  departments: string[];
  units: { id: string; name: string }[];
  roles: RoleInfo[];
  onClose: () => void;
  onSaved: (department: string) => void;
}) {
  const [department, setDepartment] = useState(set?.department ?? '');
  const [docType, setDocType] = useState(set?.docType ?? '');
  const [unitId, setUnitId] = useState(set?.unitId ?? '');
  const [noAmount, setNoAmount] = useState(String(set?.noAmountLevels ?? 1));
  const [nextKey, setNextKey] = useState(10);
  const [rows, setRows] = useState<Row[]>(
    set
      ? set.levels.map((l, i) => ({
          key: i,
          threshold: String(Number(l.threshold)),
          approver: l.approverRoleId ? `role:${l.approverRoleId}` : `user:${l.approverUserId}`,
          userName: l.approverUserName ?? '',
          sla: String(l.slaHours),
          escalate: l.escalateRoleId ? `role:${l.escalateRoleId}` : '',
        }))
      : [blankRow(0, '0')],
  );
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const locked = Boolean(set);

  const roleOptions = useMemo(
    () => roles.filter((r) => r.status !== 'INACTIVE').sort((a, b) => a.level - b.level),
    [roles],
  );
  const update = (key: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setFields({});
    if (!department) {
      setFields({ department: 'Choose a department.' });
      return;
    }
    const levels: LevelInput[] = [];
    for (const [i, r] of rows.entries()) {
      const [kind, id] = r.approver.split(':');
      if (!id) {
        setFields({ [`level${i + 1}`]: 'Choose a role.' });
        setError(`Choose a role or a named user for level ${i + 1}, not both.`);
        return;
      }
      const [ekind, eid] = r.escalate.split(':');
      levels.push({
        level: i + 1,
        threshold: Number(r.threshold === '' ? Number.NaN : r.threshold),
        approverRoleId: kind === 'role' ? id : null,
        approverUserId: kind === 'user' ? id : null,
        slaHours: Number(r.sla),
        escalateRoleId: ekind === 'role' && eid ? eid : null,
        escalateUserId: null,
      });
    }
    if (levels.some((l) => Number.isNaN(l.threshold) || Number.isNaN(l.slaHours))) {
      setError('Enter a threshold and SLA for every level.');
      return;
    }
    setPending(true);
    try {
      await saveRuleSet({
        ...(set ? { id: set.id, version: set.version } : {}),
        department,
        docType: docType || null,
        unitId: unitId || null,
        noAmountLevels: Number(noAmount),
        levels,
      });
      onSaved(department);
    } catch (err) {
      const ui = toUiError(err);
      setError(ui.message);
      setFields(ui.fields);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={set ? 'Edit rule set' : 'Add Rule Set'}
      sub="Levels run one after another. The most specific set wins."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" form="matrix-set-form" className="btn primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="matrix-set-form" onSubmit={(e) => void save(e)} noValidate>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ms-dept">Department *</label>
            <select
              id="ms-dept"
              value={department}
              disabled={locked}
              onChange={(e) => setDepartment(e.target.value)}
              aria-invalid={fields.department ? true : undefined}
            >
              <option value="">Choose…</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {fields.department ? <span className="field-error">{fields.department}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="ms-doc">Document type</label>
            <select
              id="ms-doc"
              value={docType}
              disabled={locked}
              onChange={(e) => setDocType(e.target.value)}
            >
              <option value="">All documents</option>
              {DOC_OPTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ms-unit">Unit</label>
            <select
              id="ms-unit"
              value={unitId}
              disabled={locked}
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <table className="level-table">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">From amount (₹)</th>
              <th scope="col">Approver role</th>
              <th scope="col">SLA (h)</th>
              <th scope="col">Escalate to</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const err = fields[`level${i + 1}`];
              return (
                <tr key={r.key} aria-label={`Level ${i + 1}`}>
                  <td>L{i + 1}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      aria-label={`Level ${i + 1} threshold`}
                      value={r.threshold}
                      onChange={(e) => update(r.key, { threshold: e.target.value })}
                      aria-invalid={err ? true : undefined}
                    />
                  </td>
                  <td>
                    {r.approver.startsWith('user:') ? (
                      <span className="chip">{r.userName || 'Named user'}</span>
                    ) : (
                      <select
                        aria-label={`Level ${i + 1} approver`}
                        value={r.approver}
                        onChange={(e) => update(r.key, { approver: e.target.value })}
                      >
                        <option value="">Choose a role…</option>
                        {roleOptions.map((role) => (
                          <option key={role.id} value={`role:${role.id}`}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      aria-label={`Level ${i + 1} SLA hours`}
                      value={r.sla}
                      onChange={(e) => update(r.key, { sla: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Level ${i + 1} escalate to`}
                      value={r.escalate}
                      onChange={(e) => update(r.key, { escalate: e.target.value })}
                    >
                      <option value="">Nobody</option>
                      {roleOptions.map((role) => (
                        <option key={role.id} value={`role:${role.id}`}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {rows.length > 1 && i === rows.length - 1 ? (
                      <button
                        type="button"
                        className="btn sm"
                        aria-label={`Remove level ${i + 1}`}
                        onClick={() => setRows((rs) => rs.slice(0, -1))}
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                  {err ? (
                    <td className="field-error" role="alert">
                      {err}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length < 10 ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setRows((rs) => [...rs, blankRow(nextKey)]);
              setNextKey((k) => k + 1);
            }}
          >
            ＋ Add level
          </button>
        ) : null}
        <div className="field">
          <label htmlFor="ms-noamt">Levels for documents without amount</label>
          <select id="ms-noamt" value={noAmount} onChange={(e) => setNoAmount(e.target.value)}>
            {rows.map((_r, i) => (
              <option key={i} value={String(i + 1)}>
                {i + 1}
              </option>
            ))}
          </select>
          {fields.noAmountLevels ? (
            <span className="field-error">{fields.noAmountLevels}</span>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({
  set,
  onClose,
  onDeleted,
}: {
  set: RuleSet;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const run = async (): Promise<void> => {
    setPending(true);
    try {
      await deleteRuleSet(set.id);
      onDeleted();
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      size="sm"
      title="Delete rule set"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() => void run()}
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <p className="confirm-text">
        Delete the rule set of {set.department} for {set.docTitle ?? 'all documents'} (
        {set.unitCode ?? 'all units'})? Requests already in flight keep their approvers.
      </p>
    </Modal>
  );
}
