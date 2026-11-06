// Delegations tab: the "I will be away" form (To user, From, To, Department, Reason) and the list
// of delegations given to / received from others with Revoke.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import {
  createDelegation,
  listDelegations,
  revokeDelegation,
  searchDelegationTargets,
  type Delegation,
  type Person,
} from '../../lib/approvalsApi';
import { toUiError } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { activeDepartmentNames } from '../admin/adminApi';
import type { User } from '../../types';

const today = (): string => new Date().toISOString().slice(0, 10);

export function DelegationsTab({ user }: { user: User }) {
  const toast = useToast();
  const list = useLoad(listDelegations, []);
  const depts = useLoad(activeDepartmentNames, []);
  const [target, setTarget] = useState<Person | null>(null);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [department, setDepartment] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!target) {
      setFields({ toUserId: 'Choose who will act for you.' });
      return;
    }
    setPending(true);
    setError('');
    setFields({});
    try {
      await createDelegation({
        toUserId: target.id,
        fromDate: from,
        toDate: to,
        ...(department ? { department } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast(`${target.name} can now approve for you.`);
      setTarget(null);
      setReason('');
      list.reload();
    } catch (err) {
      const ui = toUiError(err);
      setError(ui.message);
      setFields(ui.fields);
    } finally {
      setPending(false);
    }
  };

  const revoke = async (d: Delegation): Promise<void> => {
    try {
      await revokeDelegation(d.id);
      toast('Delegation revoked.');
      list.reload();
    } catch (err) {
      setError(toUiError(err).message);
    }
  };

  return (
    <div className="grid2">
      <form className="card panel" onSubmit={(e) => void save(e)} aria-label="I will be away">
        <h3>I will be away</h3>
        <p className="v8-sub">
          The person you choose can approve for you between these dates. They act with your role and
          limit, and the history shows “on behalf of {user.name}”.
        </p>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <TargetPicker value={target} onChange={setTarget} error={fields.toUserId} />
        <Field
          label="From *"
          type="date"
          value={from}
          min={today()}
          onChange={(e) => setFrom(e.target.value)}
          error={fields.fromDate}
        />
        <Field
          label="To *"
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          error={fields.toDate}
        />
        <div className="field">
          <label htmlFor="deleg-dept">Department</label>
          <select
            id="deleg-dept"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All my departments</option>
            {(depts.data ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Reason"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Delegate'}
        </button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Dates</th>
              <th scope="col">Department</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((d) => (
              <tr key={d.id}>
                <td>
                  {d.direction === 'given'
                    ? `${d.toUser.name} acts for you`
                    : `You act for ${d.fromUser.name}`}
                </td>
                <td>
                  {formatDate(d.fromDate)} – {formatDate(d.toDate)}
                </td>
                <td>{d.department ?? 'All'}</td>
                <td>
                  <span
                    className={`status ${d.status === 'REVOKED' ? 'cancelled' : d.inEffect ? 'approved' : 'pending'}`}
                  >
                    {d.status === 'REVOKED' ? 'Revoked' : d.inEffect ? 'In effect' : 'Scheduled'}
                  </span>
                </td>
                <td>
                  {d.status === 'ACTIVE' && d.direction === 'given' ? (
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={`Revoke delegation to ${d.toUser.name}`}
                      onClick={() => void revoke(d)}
                    >
                      Revoke
                    </button>
                  ) : (
                    <span className="v8-sub">—</span>
                  )}
                </td>
              </tr>
            ))}
            {list.data && list.data.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5}>No delegations. Use the form to let someone act for you.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TargetPicker({
  value,
  onChange,
  error,
}: {
  value: Person | null;
  onChange: (p: Person | null) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || value) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchDelegationTargets(q)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text, value]);
  return (
    <div className="field">
      <label htmlFor={id}>To user *</label>
      {value ? (
        <div className="actions">
          <span className="chip">{value.name}</span>
          <button type="button" className="btn sm" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            type="search"
            placeholder="Type a name or login ID…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          {results.length > 0 ? (
            <ul className="lookup-list" role="listbox" aria-label="Matching users">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="btn sm"
                    onClick={() => {
                      onChange(r);
                      setText('');
                    }}
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
