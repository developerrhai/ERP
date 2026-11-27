// Record Document Format: standard quality formats and records filed by category, with "Create Category". Also the
// editor of checklists and audit forms (Template & Feature).
import { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { docsMailApi, saveFile } from '../../../lib/docsMailApi';
import { toUiError } from '../../../lib/errors';
import { qdelete, qget, qpatch, qpost } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { dmy, Empty, ErrorBox, Pill } from '../../finance/shared';
import type { PageSchema } from '../../generic/engineApi';
import { DocumentsPanel } from '../../generic/DocumentsPanel';
import { Confirm } from '../../wms/WmsRegister';
import { messageOf } from './shared';

export interface Category {
  id: string;
  name: string;
  description: string | null;
  status: string;
  formats: number;
}
export interface Format {
  id: string;
  type: 'CHECKLIST' | 'AUDIT_FORM' | 'RECORD_FORMAT';
  categoryId: string | null;
  categoryName: string | null;
  code: string;
  title: string;
  revision: number;
  effectiveDate: string | null;
  points: string[];
  notes: string | null;
  status: string;
  version: number;
}
export const TYPE_LABEL: Record<Format['type'], string> = { CHECKLIST: 'Checklist', AUDIT_FORM: 'Audit form', RECORD_FORMAT: 'Record format' };

export function CategoryDialog({ category, onClose, onSaved }: { category: Category | null; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (name.trim().length < 2) return setError('Name the category.');
    setBusy(true);
    setError('');
    try {
      let id = category?.id ?? '';
      if (category) await qpatch(`/categories/${category.id}`, 0, { name, description });
      else id = (await qpost<{ id: string }>('/categories', { name, description })).id;
      toast(`Category ${name.trim()} saved.`);
      onSaved(id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={category ? 'Edit category' : 'Create Category'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="field">
        <label htmlFor="qv-cat-name">Category name *</label>
        <input id="qv-cat-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="qv-cat-desc">Description</label>
        <textarea id="qv-cat-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}

/** Add or edit a checklist, audit form or record format. */
export function FormatForm({ type, id, categories, onNewCategory, onClose, onSaved }: { type: Format['type']; id: string | null; categories: Category[]; onNewCategory?: () => void; onClose: () => void; onSaved: (f: Format) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: '', title: '', categoryId: '', revision: '0', effectiveDate: '', points: '', notes: '' });
  const [kind, setKind] = useState<Format['type']>(type);
  const [version, setVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const record = kind === 'RECORD_FORMAT';
  useEffect(() => {
    if (!id) return;
    let alive = true;
    qget<Format>(`/formats/${id}`)
      .then((r) => {
        if (!alive) return;
        setKind(r.type);
        setVersion(r.version);
        setF({ code: r.code, title: r.title, categoryId: r.categoryId ?? '', revision: String(r.revision), effectiveDate: r.effectiveDate ?? '', points: r.points.join('\n'), notes: r.notes ?? '' });
      })
      .catch((e: unknown) => alive && setMsg(messageOf(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const save = async (): Promise<void> => {
    const missing: Record<string, string> = {};
    if (!f.code.trim()) missing.code = 'Enter the format number.';
    if (f.title.trim().length < 3) missing.title = 'Write the title.';
    if (record && !f.categoryId) missing.categoryId = 'Choose a category. Use Create Category to add one.';
    if (!record && !f.points.trim()) missing.points = 'Add at least one check point (one per line).';
    if (!/^\d{1,3}$/.test(f.revision)) missing.revision = 'Enter a whole number.';
    setErrors(missing);
    setMsg(Object.keys(missing).length ? 'Please fill the marked fields.' : '');
    if (Object.keys(missing).length) return;
    const body = {
      code: f.code,
      title: f.title,
      categoryId: f.categoryId || null,
      revision: Number(f.revision),
      effectiveDate: f.effectiveDate || null,
      points: f.points.split('\n').map((p) => p.trim()).filter(Boolean),
      notes: f.notes,
    };
    setBusy(true);
    try {
      const r = id && version !== null ? await qpatch<Format>(`/formats/${id}`, version, body) : await qpost<Format>('/formats', { type: kind, ...body });
      toast(`Saved ${r.code}`);
      onSaved(r);
    } catch (e) {
      const u = toUiError(e);
      setMsg(u.message);
      setErrors(u.fields);
    } finally {
      setBusy(false);
    }
  };

  const input = (k: keyof typeof f, label: string, t = 'text', required = false) => (
    <div className="field">
      <label htmlFor={`qv-f-${k}`}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input id={`qv-f-${k}`} type={t} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      {errors[k] ? <div className="field-error">{errors[k]}</div> : null}
    </div>
  );
  return (
    <Modal
      title={`${id ? 'Edit' : 'Add'} ${TYPE_LABEL[kind].toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox message={msg} />
      <div className="form-grid">
        {input('code', 'Format number', 'text', true)}
        {input('title', 'Title', 'text', true)}
        <div className="field">
          <label htmlFor="qv-f-category">Category{record ? ' *' : ''}</label>
          <select id="qv-f-category" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">— choose —</option>
            {categories
              .filter((c) => c.status === 'ACTIVE' || c.id === f.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          {errors.categoryId ? <div className="field-error">{errors.categoryId}</div> : null}
          {onNewCategory ? (
            <button type="button" className="link" onClick={onNewCategory}>
              Create Category
            </button>
          ) : null}
        </div>
        {input('revision', 'Revision no.')}
        {input('effectiveDate', 'Effective date', 'date')}
        <div className="field wide">
          <label htmlFor="qv-f-points">{record ? 'Contents (one per line)' : 'Check points (one per line) *'}</label>
          <textarea id="qv-f-points" rows={6} value={f.points} onChange={(e) => set('points', e.target.value)} />
          {errors.points ? <div className="field-error">{errors.points}</div> : null}
        </div>
        <div className="field wide">
          <label htmlFor="qv-f-notes">Notes</label>
          <textarea id="qv-f-notes" rows={2} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

/** One format with its check points and attached files. */
export function FormatView({ id, actions, onClose, onEdit }: { id: string; actions: ActionSet; onClose: () => void; onEdit: (id: string) => void }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const load = useLoad(() => qget<Format>(`/formats/${id}`), [id, tick]);
  const r = load.data;
  return (
    <Modal
      title={r ? r.code : 'Loading…'}
      sub={r ? r.title : ''}
      onClose={onClose}
      footer={
        r ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                docsMailApi
                  .print('qms-templates', r.id, 'standard')
                  .then((file) => saveFile(file, `${r.code}.pdf`))
                  .catch((e: unknown) => toast(messageOf(e)));
              }}
            >
              PDF
            </button>
            {actions.edit ? (
              <button type="button" className="btn primary" onClick={() => onEdit(r.id)}>
                Edit
              </button>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </>
        ) : undefined
      }
    >
      <ErrorBox message={load.error} />
      {r ? (
        <>
          <p className="qv-pills">
            <Pill>{r.status === 'ACTIVE' ? 'Active' : 'Retired'}</Pill> {TYPE_LABEL[r.type]} · revision {r.revision}
            {r.categoryName ? ` · ${r.categoryName}` : ''}
            {r.effectiveDate ? ` · effective ${dmy(r.effectiveDate)}` : ''}
          </p>
          {r.points.length ? (
            <ol className="qv-points">
              {r.points.map((p, i) => (
                <li key={`${p}-${i}`}>{p}</li>
              ))}
            </ol>
          ) : null}
          {r.notes ? <p className="qv-text">{r.notes}</p> : null}
          <DocumentsPanel
            schema={{ pageId: 'qms-templates' } as unknown as PageSchema}
            row={{ id: r.id, code: r.code, status: r.status }}
            canEdit={actions.edit}
            onChanged={() => setTick((n) => n + 1)}
          />
        </>
      ) : null}
    </Modal>
  );
}

/** The Record Document Format tab: categories on top, the formats filed under the chosen one below. */
export function RecordFormats({ actions, onChanged }: { actions: ActionSet; onChanged?: () => void }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [catForm, setCatForm] = useState<{ category: Category | null } | null>(null);
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ id: string; label: string; what: 'categories' | 'formats' } | null>(null);
  const [error, setError] = useState('');
  const reload = (): void => {
    setTick((n) => n + 1);
    onChanged?.();
  };
  const cats = useLoad(() => qget<{ rows: Category[] }>('/categories'), [tick]);
  const list = useLoad(
    () => qget<{ rows: Format[] }>('/formats', { type: 'RECORD_FORMAT', categoryId: category || undefined, q: q || undefined }),
    [tick, category, q],
  );
  const categories = cats.data?.rows ?? [];
  const chosen = categories.find((c) => c.id === category) ?? null;
  const run = (work: Promise<unknown>, done: string): void => {
    setError('');
    work
      .then(() => toast(done))
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(reload);
  };
  return (
    <section className="qv-formats" aria-label="Record Document Format">
      <ErrorBox message={error || cats.error || list.error} />
      <div className="toolbar">
        {actions.add ? (
          <>
            <button type="button" className="btn primary" onClick={() => setCatForm({ category: null })}>
              ＋ Create Category
            </button>
            <button type="button" className="btn" onClick={() => setForm({ id: null })}>
              ＋ Add Record Format
            </button>
          </>
        ) : null}
        <input aria-label="Search formats" placeholder="Search number or title" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="qv-chips" role="group" aria-label="Categories">
        <button type="button" className={`chip${category === '' ? ' on' : ''}`} aria-pressed={category === ''} onClick={() => setCategory('')}>
          All categories
        </button>
        {categories.map((c) => (
          <button key={c.id} type="button" className={`chip${category === c.id ? ' on' : ''}`} aria-pressed={category === c.id} title={c.description ?? undefined} onClick={() => setCategory(c.id)}>
            {c.name} ({c.formats}){c.status === 'ACTIVE' ? '' : ' · off'}
          </button>
        ))}
      </div>
      {chosen ? (
        <div className="toolbar">
          <span>
            Category <b>{chosen.name}</b>
            {chosen.description ? `: ${chosen.description}` : ''}
          </span>
          {actions.edit ? (
            <>
              <button type="button" className="btn sm" onClick={() => setCatForm({ category: chosen })}>
                Edit category
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => run(qpatch(`/categories/${chosen.id}`, 0, { status: chosen.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), `${chosen.name} switched ${chosen.status === 'ACTIVE' ? 'off' : 'on'}.`)}
              >
                {chosen.status === 'ACTIVE' ? 'Switch off' : 'Switch on'}
              </button>
            </>
          ) : null}
          {actions.delete ? (
            <button type="button" className="btn sm danger" onClick={() => setRemove({ id: chosen.id, label: chosen.name, what: 'categories' })}>
              Delete category
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="card table-wrap">
        <table className="register-table plain">
          <thead>
            <tr>
              <th>Format No</th>
              <th>Title</th>
              <th>Category</th>
              <th>Revision</th>
              <th>Effective</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.title}</td>
                <td>{r.categoryName ?? '—'}</td>
                <td className="num">{r.revision}</td>
                <td>{dmy(r.effectiveDate)}</td>
                <td>
                  <Pill>{r.status === 'ACTIVE' ? 'Active' : 'Retired'}</Pill>
                </td>
                <td className="row-actions">
                  <div className="qv-buttons">
                    <button type="button" className="btn sm" onClick={() => setView(r.id)}>
                      View / Files
                    </button>
                    {actions.edit ? (
                      <>
                        <button type="button" className="btn sm" onClick={() => setForm({ id: r.id })}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => run(qpatch(`/formats/${r.id}`, r.version, { status: r.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE' }), `${r.code} ${r.status === 'ACTIVE' ? 'retired' : 'activated'}.`)}
                        >
                          {r.status === 'ACTIVE' ? 'Retire' : 'Activate'}
                        </button>
                      </>
                    ) : null}
                    {actions.delete ? (
                      <button type="button" className="btn sm danger" onClick={() => setRemove({ id: r.id, label: r.code, what: 'formats' })}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {(list.data?.rows.length ?? 0) === 0 && !list.loading ? (
              <Empty cols={7}>{categories.length === 0 ? 'Create a category first, then add the record formats that belong to it.' : 'No record formats here yet.'}</Empty>
            ) : null}
          </tbody>
        </table>
      </div>
      {catForm ? (
        <CategoryDialog
          category={catForm.category}
          onClose={() => setCatForm(null)}
          onSaved={() => {
            setCatForm(null);
            reload();
          }}
        />
      ) : null}
      {form ? (
        <FormatForm
          type="RECORD_FORMAT"
          id={form.id}
          categories={categories}
          onNewCategory={actions.add ? () => setCatForm({ category: null }) : undefined}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
        />
      ) : null}
      {view && !form ? <FormatView id={view} actions={actions} onClose={() => setView(null)} onEdit={(id) => setForm({ id })} /> : null}
      {remove ? (
        <Confirm
          title={`Delete ${remove.label}?`}
          text={remove.what === 'categories' ? 'A category with records filed under it cannot be deleted; switch it off instead.' : 'The record format leaves the list.'}
          action="Delete"
          onClose={() => setRemove(null)}
          onConfirm={() => {
            const r = remove;
            setRemove(null);
            if (r.what === 'categories') setCategory('');
            run(qdelete(`/${r.what}/${r.id}`), `${r.label} deleted.`);
          }}
        />
      ) : null}
    </section>
  );
}
