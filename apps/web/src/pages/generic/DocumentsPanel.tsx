// Documents of one record (docs/phases/PHASE-04.md §9): list with scan badge, upload, download,
// remove. Add / remove follow the server's lock matrix (`schema.lock`), download is always offered.
// Also the "Documents" tab of a module page, which first lets the user pick a record.
import { useRef, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { formatDateTime } from '../../lib/format';
import { toUiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { listRecords, type PageSchema, type RecordRow } from './engineApi';
import {
  ACCEPT,
  DOC_TYPES,
  MAX_FILE_MB,
  deleteDocument,
  downloadDocument,
  formatBytes,
  listDocuments,
  lockAllows,
  uploadDocument,
  type DocumentRow,
} from './phase4Api';

interface Props {
  schema: PageSchema;
  row: Pick<RecordRow, 'id' | 'code' | 'status'>;
  /** The user has the page's Edit permission (needed to add / remove). */
  canEdit: boolean;
  onChanged?: () => void;
}

export function DocumentsPanel({ schema, row, canEdit, onChanged }: Props) {
  const docs = useLoad(() => listDocuments(schema.pageId, row.id), [schema.pageId, row.id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('GENERAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = canEdit && lockAllows(schema.lock, row.status, 'documents');

  const upload = async (): Promise<void> => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`The file is larger than ${MAX_FILE_MB} MB.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await uploadDocument(schema.pageId, row.id, file, {
        ...(title.trim() ? { title: title.trim() } : {}),
        docType,
      });
      if (fileRef.current) fileRef.current.value = '';
      setTitle('');
      docs.reload();
      onChanged?.();
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: DocumentRow): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await deleteDocument(schema.pageId, row.id, doc.id);
      docs.reload();
      onChanged?.();
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (doc: DocumentRow): Promise<void> => {
    setError('');
    try {
      await downloadDocument(schema.pageId, row.id, doc);
    } catch (err) {
      setError(toUiError(err).message);
    }
  };

  const rows = docs.data ?? [];
  return (
    <section className="drawer-section documents-panel" aria-label="Documents">
      <h3>Documents</h3>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {docs.error ? <ErrorMessage>{docs.error}</ErrorMessage> : null}
      {docs.loading && !docs.data ? <p className="v8-sub">Loading…</p> : null}
      {docs.data && rows.length === 0 ? (
        <p className="v8-sub">No documents yet for {row.code}.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="doc-list">
          {rows.map((d) => (
            <li key={d.id}>
              <div>
                <b>{d.title}</b> <span className="chip">{d.docType.toLowerCase()}</span>{' '}
                <span className={d.scanStatus === 'CLEAN' ? 'status active' : 'status draft'}>
                  {d.scanStatus === 'CLEAN' ? 'Scanned' : d.scanStatus.toLowerCase()}
                </span>
                <div className="v8-sub">
                  {d.fileName} • {formatBytes(d.size)} • {formatDateTime(d.createdAt)}
                  {d.createdBy ? ` • ${d.createdBy.name}` : ''}
                </div>
              </div>
              <div className="doc-actions">
                <button
                  type="button"
                  className="btn sm"
                  aria-label={`Download ${d.title}`}
                  onClick={() => void save(d)}
                >
                  Download
                </button>
                {allowed ? (
                  <button
                    type="button"
                    className="btn sm danger"
                    aria-label={`Remove ${d.title}`}
                    disabled={busy}
                    onClick={() => void remove(d)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {allowed ? (
        <div className="doc-upload">
          <label>
            File
            <input ref={fileRef} type="file" accept={ACCEPT} aria-label="Document file" />
          </label>
          <label>
            Title
            <input
              type="text"
              value={title}
              maxLength={200}
              placeholder="Optional"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Type
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0) + t.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void upload()}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
          <p className="v8-sub">PDF, PNG, JPG, XLSX, DOCX or CSV, up to {MAX_FILE_MB} MB.</p>
        </div>
      ) : (
        <p className="v8-sub">
          {canEdit
            ? `Documents cannot be added or removed while the record is ${row.status}.`
            : 'You can download documents; adding needs the Edit permission.'}
        </p>
      )}
    </section>
  );
}

/** The "Documents" tab of a module page: pick a record, then manage its documents. */
export function DocumentsTab({ schema, canEdit }: { schema: PageSchema; canEdit: boolean }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<RecordRow | null>(null);
  const list = useLoad(
    () => listRecords(schema.pageId, { q, size: 10, sort: '-createdAt' }),
    [schema.pageId, q],
  );
  return (
    <div className="card panel documents-tab">
      <h3>Documents</h3>
      <p className="v8-sub">Find a record, then attach or download its documents.</p>
      <input
        type="search"
        aria-label="Find a record"
        placeholder="Search by code or name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {list.error ? <ErrorMessage>{list.error}</ErrorMessage> : null}
      {list.data && list.data.rows.length === 0 ? (
        <p className="v8-sub">No records match.</p>
      ) : null}
      <ul className="doc-record-list">
        {(list.data?.rows ?? []).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={picked?.id === r.id ? 'btn sm primary' : 'btn sm'}
              onClick={() => setPicked(r)}
            >
              {r.code} — {r.status}
            </button>
          </li>
        ))}
      </ul>
      {picked ? <DocumentsPanel schema={schema} row={picked} canEdit={canEdit} /> : null}
    </div>
  );
}
