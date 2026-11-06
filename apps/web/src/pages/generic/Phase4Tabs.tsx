// Phase 4 screens: the Import wizard, the report extras (CSV, PDF, background export + job list),
// the server-side Data Quality tab and the roadmap phase map. Numbers come from the server
// (docs/phases/PHASE-04.md §9); empty states say what to do (ROADMAP R-15).
import { useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { formatDateTime } from '../../lib/format';
import { toUiError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import type { PageSchema } from './engineApi';
import {
  commitImport,
  downloadImportTemplate,
  downloadJob,
  exportCsv,
  getJob,
  getQuality,
  isJobFinished,
  listJobs,
  openListPdf,
  startExportJob,
  uploadImport,
  validateImport,
  type ExportFilters,
  type ImportCheck,
  type ImportUpload,
  type JobRow,
} from './phase4Api';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls a job until it finishes (or the caller stops it); the server keeps working regardless. */
async function waitFor(jobId: string, alive: () => boolean): Promise<JobRow> {
  for (let i = 0; i < 300; i += 1) {
    const job = await getJob(jobId);
    if (isJobFinished(job) || !alive()) return job;
    await delay(1000);
  }
  return getJob(jobId);
}

// ---- Import wizard ---------------------------------------------------------------

type Step = 1 | 2 | 3 | 4;

export function ImportWizard({
  schema,
  onClose,
  onImported,
}: {
  schema: PageSchema;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [check, setCheck] = useState<{ job: JobRow; detail: ImportCheck } | null>(null);
  const [result, setResult] = useState<JobRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    // StrictMode mounts, unmounts and re-mounts: the flag must be raised again on every mount.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const doUpload = () =>
    run(async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('Choose a .xlsx or .csv file first.');
      const up = await uploadImport(schema.pageId, file);
      setUpload(up);
      setMapping(up.suggestedMapping);
      setStep(2);
    });

  const doValidate = () =>
    run(async () => {
      if (!upload) return;
      setStep(3);
      setCheck(null);
      await validateImport(upload.job.id, mapping);
      const job = await waitFor(upload.job.id, () => aliveRef.current);
      if (job.status === 'FAILED') {
        const msg = (job.errors as { message?: string } | null)?.message;
        throw new Error(msg ?? 'The file could not be checked.');
      }
      setCheck({ job, detail: job.errors as ImportCheck });
    });

  const doCommit = () =>
    run(async () => {
      if (!upload) return;
      setStep(4);
      const started = await commitImport(upload.job.id);
      const job = await waitFor(started.id, () => aliveRef.current);
      setResult(job);
      if (job.status === 'DONE') onImported();
    });

  const missingRequired = (upload?.fields ?? []).filter(
    (f) => f.required && mapping[f.key] === undefined,
  );
  const failed = result?.status === 'FAILED';
  const failMessage = (result?.errors as { message?: string } | null)?.message;

  return (
    <Modal
      title={`Import ${schema.title}`}
      sub={`Step ${step} of 4 — ${['Upload file', 'Map columns', 'Check', 'Import'][step - 1]}`}
      onClose={onClose}
      footer={
        <>
          {step === 2 ? (
            <>
              <button type="button" className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || missingRequired.length > 0}
                onClick={() => void doValidate()}
              >
                Check file
              </button>
            </>
          ) : null}
          {step === 3 && check ? (
            <>
              <button type="button" className="btn" onClick={() => setStep(2)}>
                Back to mapping
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || check.job.errorRows !== 0}
                onClick={() => void doCommit()}
              >
                Import {check.job.totalRows} records
              </button>
            </>
          ) : null}
          {step === 1 ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void doUpload()}
            >
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          ) : null}
          {step === 4 && result ? (
            <button type="button" className="btn primary" onClick={onClose}>
              Close
            </button>
          ) : null}
        </>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      {step === 1 ? (
        <div className="import-step">
          <p>
            Upload an Excel (.xlsx) or CSV file with a heading row. Up to 5,000 rows and 5 MB. The
            import is all-or-nothing: if any row is wrong, nothing is created.
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" aria-label="Import file" />
          <p>
            <button
              type="button"
              className="btn sm"
              onClick={() => void downloadImportTemplate(schema.pageId).catch(() => undefined)}
            >
              Download template
            </button>
          </p>
        </div>
      ) : null}

      {step === 2 && upload ? (
        <div className="import-step">
          <p className="v8-sub">
            {upload.totalRows} data rows found. Match each field to a column of your file.
          </p>
          <table className="quality-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Column in your file</th>
              </tr>
            </thead>
            <tbody>
              {upload.fields.map((f) => (
                <tr key={f.key}>
                  <td>
                    {f.label}
                    {f.required ? <span aria-label="required"> *</span> : null}
                  </td>
                  <td>
                    <select
                      aria-label={`Column for ${f.label}`}
                      value={mapping[f.key] ?? ''}
                      onChange={(e) =>
                        setMapping((m) => {
                          const next = { ...m };
                          if (e.target.value === '') delete next[f.key];
                          else next[f.key] = Number(e.target.value);
                          return next;
                        })
                      }
                    >
                      <option value="">— not imported —</option>
                      {upload.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {missingRequired.length > 0 ? (
            <p className="field-error" role="alert">
              Map a column to: {missingRequired.map((f) => f.label).join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="import-step">
          {!check && !error ? <p role="status">Checking the file…</p> : null}
          {check ? (
            <>
              <p role="status">
                <b>{check.job.okRows}</b> of {check.job.totalRows} rows are valid
                {check.job.errorRows ? `; ${check.job.errorRows} have problems.` : '.'}
              </p>
              {check.detail.errors.length > 0 ? (
                <table className="quality-table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.detail.errors.slice(0, 50).map((e) => (
                      <tr key={e.row}>
                        <td>{e.row}</td>
                        <td>
                          {Object.entries(e.fields)
                            .map(([k, v]) => (k === '_' ? v : `${k}: ${v}`))
                            .join('; ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {check.detail.warnings.length > 0 ? (
                <div className="notice" role="note">
                  <b>Warnings</b>{' '}
                  {check.detail.warnings
                    .slice(0, 5)
                    .map((w) => `row ${w.row}: ${w.message}`)
                    .join(' • ')}
                  {check.detail.warnings.length > 5 ? ' …' : ''} (these can still be imported)
                </div>
              ) : null}
              {check.job.errorRows ? (
                <p className="v8-sub">Fix the file (or the mapping) and check again.</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {step === 4 ? (
        <div className="import-step">
          {!result && !error ? <p role="status">Importing…</p> : null}
          {result && !failed ? (
            <p role="status">
              Done — <b>{result.okRows}</b> records created.
            </p>
          ) : null}
          {failed ? (
            <p className="field-error" role="alert">
              {failMessage ?? 'The import failed. Nothing was imported.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

// ---- Reports extras ---------------------------------------------------------------

export function ReportExtras({
  schema,
  perms,
  filters,
  onImported,
}: {
  schema: PageSchema;
  perms: ActionSet;
  filters: ExportFilters;
  onImported: () => void;
}) {
  const jobs = useLoad(() => listJobs(schema.pageId), [schema.pageId]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wizard, setWizard] = useState(false);
  const pending = (jobs.data ?? []).some((j) => !isJobFinished(j));
  const reload = jobs.reload;
  useEffect(() => {
    if (!pending) return undefined;
    const t = setTimeout(reload, 2000);
    return () => clearTimeout(t);
  }, [pending, jobs.data, reload]);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(toUiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const canImport = perms.add && perms.export && !schema.readOnly;
  return (
    <div className="report-extras no-print">
      {perms.export ? (
        <div className="v8-table-toolbar">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void act(() => exportCsv(schema.pageId, filters))}
          >
            CSV
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void act(() => openListPdf(schema.pageId, filters))}
          >
            PDF
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await startExportJob(schema.pageId, { ...filters, format: 'xlsx' });
                reload();
              })
            }
          >
            Export in background
          </button>
          {canImport ? (
            <button type="button" className="btn" onClick={() => setWizard(true)}>
              Import…
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <h4>Exports and imports</h4>
      {jobs.data && jobs.data.length === 0 ? (
        <p className="v8-sub">
          Nothing yet. Large exports run in the background; you can leave this page and come back.
        </p>
      ) : null}
      {jobs.data && jobs.data.length > 0 ? (
        <table className="quality-table">
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Rows</th>
              <th scope="col">File</th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.map((j) => (
              <tr key={j.id}>
                <td>{formatDateTime(j.createdAt)}</td>
                <td>
                  {j.kind === 'EXPORT'
                    ? 'Export'
                    : j.kind === 'IMPORT_COMMIT'
                      ? 'Import'
                      : 'Import check'}
                </td>
                <td>
                  <span className={`status ${j.status.toLowerCase()}`}>
                    {j.status.toLowerCase()}
                  </span>
                </td>
                <td>{j.okRows ?? j.totalRows ?? '—'}</td>
                <td>
                  {j.kind === 'EXPORT' && j.status === 'DONE' && j.hasOutput ? (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => void act(() => downloadJob(j))}
                    >
                      Download
                    </button>
                  ) : j.status === 'DONE' && j.kind === 'EXPORT' ? (
                    'Expired'
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {wizard ? (
        <ImportWizard
          schema={schema}
          onClose={() => {
            setWizard(false);
            reload();
          }}
          onImported={onImported}
        />
      ) : null}
    </div>
  );
}

// ---- Data quality (server) ----------------------------------------------------------

export function ServerQualityTab({
  schema,
  reloadToken,
}: {
  schema: PageSchema;
  reloadToken: number;
}) {
  const { data, loading, error } = useLoad(
    () => getQuality(schema.pageId),
    [schema.pageId, reloadToken],
  );
  return (
    <div className="card panel">
      <h3>Data Quality</h3>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {loading && !data ? <p className="v8-sub">Loading…</p> : null}
      {data && data.total === 0 ? (
        <p className="v8-sub">No data yet. Add or import records, then come back to check them.</p>
      ) : null}
      {data && data.total > 0 ? (
        <>
          <p className="v8-sub">
            Checked all {data.total} records of this unit and year on the server.
          </p>
          <table className="quality-table">
            <tbody>
              <tr>
                <th scope="row">Drafts older than 30 days</th>
                <td>{data.staleDrafts}</td>
              </tr>
              <tr>
                <th scope="row">Required fields left empty</th>
                <td>
                  {data.missingRequired.length === 0
                    ? 'None'
                    : data.missingRequired.map((m) => `${m.label}: ${m.count}`).join(', ')}
                </td>
              </tr>
              <tr>
                <th scope="row">
                  Repeated {data.duplicateField ? data.duplicateField.label : 'values'}
                </th>
                <td>
                  {data.duplicates.length === 0
                    ? 'None'
                    : data.duplicates.map((d) => `${d.value} (${d.count})`).join(', ')}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

// ---- Phase map ----------------------------------------------------------------------

/** docs/phases/ROADMAP.md §2 — the build order; `BUILT_UP_TO` moves as phases are accepted. */
export const ROADMAP_PHASES: readonly { n: number; name: string }[] = [
  { n: 4, name: 'Generic engine, documents, print' },
  { n: 5, name: 'Approvals and notifications' },
  { n: 6, name: 'Shared business masters' },
  { n: 7, name: 'Finance core' },
  { n: 8, name: 'Inventory and WMS' },
  { n: 9, name: 'Procurement / SCM' },
  { n: 10, name: 'CRM and Sales' },
  { n: 11, name: 'Indian taxation' },
  { n: 12, name: 'Quality / QMS' },
  { n: 13, name: 'Manufacturing' },
  { n: 14, name: 'Maintenance and assets' },
  { n: 15, name: 'HRMS' },
  { n: 16, name: 'Payroll' },
  { n: 17, name: 'Projects and service' },
  { n: 18, name: 'Logistics, fleet, gate, DMS' },
  { n: 19, name: 'Dashboards, BI, AI' },
  { n: 20, name: 'Hardening and go-live' },
];
export const BUILT_UP_TO = 5;

export function PhaseMap({ highlight }: { highlight: number }) {
  return (
    <ol className="phase-map" aria-label="Build phases">
      {ROADMAP_PHASES.map((p) => (
        <li
          key={p.n}
          className={[p.n <= BUILT_UP_TO ? 'done' : '', p.n === highlight ? 'here' : ''].join(' ')}
          aria-current={p.n === highlight ? 'step' : undefined}
        >
          <b>Phase {p.n}</b> {p.name}
          {p.n <= BUILT_UP_TO ? ' — live' : p.n === highlight ? ' — this view' : ''}
        </li>
      ))}
    </ol>
  );
}
