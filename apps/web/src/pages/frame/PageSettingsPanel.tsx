// The "⚙ Settings" tab that closes the tab strip of every page:
//  1. Columns - tick what to show on this page's register; unticked columns are hidden for this user (saved).
//  2. Lists - Items, Categories, Vendors and Manufacturers: add, rename or remove an entry; the company's lists are
//     saved on the server (needs the Admin Settings "controls" right; everybody else sees the lists read-only).
import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import {
  cleanList,
  LIST_KINDS,
  listsApi,
  setHiddenColumns,
  useHiddenColumns,
  useRegisteredColumns,
  type ListKind,
  type PickLists,
} from '../../lib/pageSettings';
import { useToast } from '../../components/Toast';

function ColumnsSection({ pageId }: { pageId: string }) {
  const cols = useRegisteredColumns(pageId);
  const hidden = useHiddenColumns(pageId);
  const shown = cols.filter((c) => !hidden.has(c.key)).length;
  return (
    <section className="ps-card" aria-label="Columns">
      <h2>Columns</h2>
      <p className="muted">Tick the columns to show on this page. Unticked columns are hidden for you.</p>
      {cols.length === 0 ? (
        <p className="muted">Open the register tab once so its columns are listed here.</p>
      ) : (
        <>
          <div className="ps-actions">
            <button type="button" className="btn sm" onClick={() => setHiddenColumns(pageId, [])}>
              Show all
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={cols.length < 2}
              onClick={() => setHiddenColumns(pageId, cols.slice(1).map((c) => c.key))}
            >
              Hide all but the first
            </button>
            <span className="muted">{`${shown} of ${cols.length} shown`}</span>
          </div>
          <div className="ps-cols">
            {cols.map((c) => (
              <label key={c.key} className="ps-col">
                <input
                  type="checkbox"
                  checked={!hidden.has(c.key)}
                  onChange={(e) => {
                    const next = new Set(hidden);
                    if (e.target.checked) next.delete(c.key);
                    else next.add(c.key);
                    // at least one column must stay visible
                    if (cols.every((x) => next.has(x.key))) return;
                    setHiddenColumns(pageId, [...next]);
                  }}
                />
                {c.label}
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ListEditor({
  kind,
  label,
  values,
  onSaved,
}: {
  kind: ListKind;
  label: string;
  values: string[];
  onSaved: (lists: PickLists) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const singular = label.replace(/ies$/, 'y').replace(/s$/, '');

  const save = async (next: string[], done: string): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      onSaved(await listsApi.put(kind, cleanList(next)));
      toast(done);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 403
          ? `You do not have the right to change the ${label.toLowerCase()} list (Admin Settings → controls).`
          : e instanceof Error
            ? e.message
            : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const v = draft.trim();
    if (!v) {
      setError(`Type the ${singular.toLowerCase()} name first.`);
      return;
    }
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already in the list.`);
      return;
    }
    await save([...values, v], `${singular} added.`);
    setDraft('');
  };

  const rename = async (i: number): Promise<void> => {
    const v = text.trim();
    if (!v) {
      setError('The name cannot be empty.');
      return;
    }
    if (values.some((x, j) => j !== i && x.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already in the list.`);
      return;
    }
    await save(values.map((x, j) => (j === i ? v : x)), `${singular} renamed.`);
    setEditing(null);
  };

  return (
    <section className="ps-card" aria-label={label}>
      <h2>{label}</h2>
      <form
        className="ps-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={120}
          placeholder={`Add a ${singular.toLowerCase()}`}
          aria-label={`New ${singular.toLowerCase()}`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn primary sm" disabled={busy}>
          ＋ Add
        </button>
      </form>
      {error ? (
        <div role="alert" className="ps-error">
          {error}
        </div>
      ) : null}
      {values.length === 0 ? (
        <p className="muted">No {label.toLowerCase()} yet.</p>
      ) : (
        <ul className="ps-list">
          {values.map((v, i) => (
            <li key={v}>
              {editing === i ? (
                <>
                  <input type="text" value={text} maxLength={120} aria-label={`Rename ${v}`} onChange={(e) => setText(e.target.value)} />
                  <button type="button" className="btn sm primary" disabled={busy} onClick={() => void rename(i)}>
                    Save
                  </button>
                  <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span>{v}</span>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditing(i);
                      setText(v);
                      setError('');
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy}
                    aria-label={`Remove ${v}`}
                    onClick={() => void save(values.filter((_, j) => j !== i), `${singular} removed.`)}
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PageSettingsPanel({ pageId }: { pageId: string }) {
  const [lists, setLists] = useState<PickLists | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    listsApi
      .get()
      .then((l) => live && setLists(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the lists.'));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="page-settings" data-testid="page-settings">
      <ColumnsSection pageId={pageId} />
      {error ? <p role="alert">{error}</p> : null}
      {lists
        ? LIST_KINDS.map((k) => <ListEditor key={k.kind} kind={k.kind} label={k.label} values={lists[k.kind]} onSaved={setLists} />)
        : !error
          ? <p className="muted">Loading lists…</p>
          : null}
    </div>
  );
}
