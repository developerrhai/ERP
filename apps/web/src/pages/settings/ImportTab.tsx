// Import a format or a rate table from an Excel file. The server parses it into a DRAFT and returns a
// validation report (row numbers, plain sentences). Nothing is live until the head publishes.
import { useRef, useState, type FormEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, SelectField } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { toUiError } from '../../lib/errors';
import { saveBlob } from '../../lib/download';
import {
  downloadTemplate,
  importExcel,
  type ImportReport,
  type SettingsKind,
} from '../../lib/settingsApi';
import { READ_ONLY_HINT } from './shared';

export function ImportTab({
  pageId,
  canEdit,
  onImported,
}: {
  pageId: string;
  canEdit: boolean;
  onImported: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<'format' | 'rate-table'>('format');
  const [kind, setKind] = useState<SettingsKind>('FORM');
  const [code, setCode] = useState('');
  const [tableName, setTableName] = useState('rates');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setReport(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose an Excel (.xlsx) file first.');
      return;
    }
    setBusy(true);
    try {
      const res = await importExcel(
        pageId,
        { target, ...(target === 'format' ? { kind } : { code, tableName }) },
        file,
      );
      setReport(res.report);
      if (res.draft) {
        toast('Imported as a draft. Review it and publish.');
        onImported();
      }
    } catch (err) {
      const ui = toUiError(err);
      setError(ui.fields.code ?? ui.fields.tableName ?? ui.message);
    }
    setBusy(false);
  };

  const onTemplate = async (): Promise<void> => {
    try {
      const { blob, filename } = await downloadTemplate(pageId, target);
      saveBlob(blob, filename ?? `${target}-template.xlsx`);
    } catch (err) {
      setError(toUiError(err).message);
    }
  };

  return (
    <section aria-label="Import from Excel">
      <p className="v8-sub">
        Upload an Excel file to create a format or a rate table. The original file is kept as
        evidence. Nothing goes live until you publish.
      </p>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <form onSubmit={(e) => void onSubmit(e)}>
        <SelectField
          label="What is in the file"
          value={target}
          onChange={(v) => setTarget(v as typeof target)}
        >
          <option value="format">A format (header, columns, totals)</option>
          <option value="rate-table">A rate table</option>
        </SelectField>
        {target === 'format' ? (
          <SelectField label="Used for" value={kind} onChange={(v) => setKind(v as SettingsKind)}>
            <option value="FORM">Data-entry form</option>
            <option value="PRINT">Print layout</option>
            <option value="REPORT">Report</option>
          </SelectField>
        ) : (
          <>
            <Field label="Rule set code *" value={code} onChange={(e) => setCode(e.target.value)} />
            <Field
              label="Table name *"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
            />
          </>
        )}
        <div className="field">
          <label htmlFor="settings-import-file">Excel file (.xlsx)</label>
          <input id="settings-import-file" ref={fileRef} type="file" accept=".xlsx" />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void onTemplate()}>
            Download a template
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={!canEdit || busy}
            title={canEdit ? undefined : READ_ONLY_HINT}
          >
            Import
          </button>
        </div>
      </form>
      {report ? (
        <div className="card" aria-label="Import report">
          <b>{report.valid ? 'File is valid.' : 'The file has problems. Nothing was imported.'}</b>
          <p>{report.summary}</p>
          {report.errors.length > 0 ? (
            <ul>
              {report.errors.map((e, i) => (
                <li key={i} className="field-error">
                  {e.row ? `Row ${e.row}: ` : ''}
                  {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          {report.warnings.length > 0 ? (
            <ul>
              {report.warnings.map((w, i) => (
                <li key={i}>
                  {w.row ? `Row ${w.row}: ` : ''}
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
