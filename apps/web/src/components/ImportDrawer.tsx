// The "Import Data" slide-over (QA report ERP-IMP-01): the top Import button opens it over the page the user is on,
// pre-selected to that module, instead of navigating to the full Import / Export workspace.
//   Choose File (CSV / JSON / Excel) -> Load & Preview Selected File -> Import & Replace Duplicates.
// The rows go to the open register through the "v40-import-rows" event; a screen that does not take them gets the
// file handed on to the Import / Export workspace.
import { useEffect, useMemo, useRef, useState } from 'react';
import { registry } from '../lib/registry';
import { readSheet, type Sheet } from '../lib/sheet';
import { useToast } from './Toast';
import './overlays.css';

export interface ImportDetail {
  pageId: string;
  rows: Record<string, string>[];
  headers: string[];
  replaceDuplicates: boolean;
  scope: 'record' | 'document';
  fileName: string;
  /** a register that took the rows sets this */
  handled: number | null;
}

export function ImportDrawer({
  pageId,
  onClose,
  onOpenWorkspace,
}: {
  pageId: string;
  onClose: () => void;
  onOpenWorkspace: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const modules = useMemo(
    () =>
      registry.families.flatMap((f) => f.items.map((i) => ({ id: i.id, label: `${f.name} › ${i.title}` }))),
    [],
  );
  const [moduleId, setModuleId] = useState(modules.some((m) => m.id === pageId) ? pageId : (modules[0]?.id ?? pageId));
  const [scope, setScope] = useState<'record' | 'document'>('record');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = async (): Promise<void> => {
    setError('');
    setSheet(null);
    if (!file) {
      setError('Choose a file first (CSV, JSON or Excel).');
      return;
    }
    setBusy(true);
    try {
      const s = await readSheet(file);
      if (s.rows.length === 0) setError('The file has no data rows.');
      else setSheet(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const doImport = (): void => {
    if (!sheet || !file) {
      setError('Load & preview the file before importing.');
      return;
    }
    const detail: ImportDetail = {
      pageId: moduleId,
      rows: sheet.rows,
      headers: sheet.headers,
      replaceDuplicates: true,
      scope,
      fileName: file.name,
      handled: null,
    };
    window.dispatchEvent(new CustomEvent<ImportDetail>('v40-import-rows', { detail }));
    if (detail.handled !== null) {
      toast(`Imported ${sheet.rows.length} row(s) from ${file.name}. Duplicates were replaced (${detail.handled} replaced).`);
      onClose();
    } else {
      toast(`${file.name} is ready. Map its columns in the Import / Export workspace to finish.`);
      onClose();
      onOpenWorkspace();
    }
  };

  const preview = sheet?.rows.slice(0, 8) ?? [];
  return (
    <div className="slideover-backdrop" onClick={onClose} data-testid="import-drawer-backdrop">
      <aside
        className="slideover"
        role="dialog"
        aria-modal="true"
        aria-label="Import Data"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="slideover-head">
          <div>
            <h2>Import Data</h2>
            <p>Bring records from a spreadsheet into the page you are on.</p>
          </div>
          <button type="button" className="btn sm" aria-label="Close import" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="slideover-body">
          <label>
            Module / Document Type
            <select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Import Scope
            <select value={scope} onChange={(e) => setScope(e.target.value === 'document' ? 'document' : 'record')}>
              <option value="record">Record (register rows)</option>
              <option value="document">Document (attach the file to the module)</option>
            </select>
          </label>
          <label>
            Choose File
            <input
              ref={input}
              type="file"
              accept=".csv,.json,.xlsx,.xls,.txt"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSheet(null);
                setError('');
              }}
            />
          </label>
          <div className="slideover-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void load()}>
              Load &amp; Preview Selected File
            </button>
          </div>
          {error ? (
            <p role="alert" className="slideover-error">
              {error}
            </p>
          ) : null}
          {sheet ? (
            <div className="slideover-preview">
              <p>
                <b>{sheet.rows.length}</b> row(s), <b>{sheet.headers.length}</b> column(s) found in <b>{file?.name}</b>. First {preview.length} shown:
              </p>
              <div className="table-wrap">
                <table className="register-table">
                  <thead>
                    <tr>
                      {sheet.headers.slice(0, 6).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i}>
                        {sheet.headers.slice(0, 6).map((h) => (
                          <td key={h}>{r[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
        <footer className="slideover-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!sheet} title={sheet ? undefined : 'Choose a file and press Load & Preview first.'} onClick={doImport}>
            Import &amp; Replace Duplicates
          </button>
        </footer>
      </aside>
    </div>
  );
}
