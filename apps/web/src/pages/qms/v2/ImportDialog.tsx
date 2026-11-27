// Import of Customer NCRs, Conformance NCRs and quality costs from a CSV / Excel file. The server checks every row
// first and writes nothing when one is wrong. The top "⇧ Import" button of the page opens this.
import { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { qpost } from '../../../lib/qmsApi';
import { readSheet, type Sheet } from '../../../lib/sheet';
import { ErrorBox } from '../../finance/shared';
import { messageOf, saveCsv } from './shared';

export type ImportKind = 'customer-ncr' | 'conformance-ncr' | 'cost';
const KINDS: Record<ImportKind, { label: string; columns: string[]; sample: string[] }> = {
  'customer-ncr': {
    label: 'Customer NCR',
    columns: ['date', 'customerNo', 'itemCode', 'reference', 'priority', 'title', 'description', 'qty', 'claimAmount', 'department', 'owner', 'targetDate'],
    sample: ['2026-11-01', 'CUST/00001', '', 'INV-104', 'Major', 'Paint peeling on delivery', 'Paint peeling on 12 panels', '12', '5000', 'Quality', 'A. Patil', '2026-11-15'],
  },
  'conformance-ncr': {
    label: 'Conformance NCR',
    columns: ['date', 'department', 'priority', 'result', 'process', 'title', 'description', 'rootCause', 'correctiveAction', 'owner', 'targetDate'],
    sample: ['2026-11-01', 'Production', 'Minor', 'Non conformance', 'Welding', 'Weld porosity', 'Porosity on 3 joints', '', '', 'A. Patil', '2026-11-15'],
  },
  cost: {
    label: 'Quality costs (COPQ)',
    columns: ['month', 'category', 'description', 'amount'],
    sample: ['2026-11', 'Prevention', 'Operator training', '2500'],
  },
};

export function ImportDialog({ kinds, onClose, onDone }: { kinds: ImportKind[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<ImportKind>(kinds[0] ?? 'cost');
  const [file, setFile] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<{ row: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const k = KINDS[kind];
  const missing = sheet ? k.columns.filter((c) => !sheet.headers.some((h) => h.trim().toLowerCase() === c.toLowerCase())) : [];

  const choose = async (f: File | undefined): Promise<void> => {
    setSheet(null);
    setError('');
    setRowErrors([]);
    setFile(f?.name ?? '');
    if (!f) return;
    try {
      const s = await readSheet(f);
      if (s.rows.length === 0) setError('The file has no data rows.');
      else if (s.rows.length > 200) setError('Import at most 200 rows at a time.');
      else setSheet(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    }
  };

  const run = async (): Promise<void> => {
    if (!sheet) return;
    setBusy(true);
    setError('');
    setRowErrors([]);
    // headings are matched without caring about capitals
    const rows = sheet.rows.map((r) =>
      Object.fromEntries(k.columns.map((c) => [c, String(r[sheet.headers.find((h) => h.trim().toLowerCase() === c.toLowerCase()) ?? c] ?? '')])),
    );
    try {
      const out = await qpost<{ imported: number; errors: { row: number; message: string }[] }>('/import', { kind, rows });
      if (out.errors.length) setRowErrors(out.errors);
      else {
        toast(`${out.imported} ${k.label} row(s) imported.`);
        onDone();
        onClose();
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import quality data"
      sub="CSV or Excel. Nothing is saved unless every row is correct."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={!sheet || busy} title={sheet ? undefined : 'Choose a file first.'} onClick={() => void run()}>
            Import
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="qv-import-kind">What to import</label>
          <select
            id="qv-import-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              setRowErrors([]);
            }}
          >
            {kinds.map((x) => (
              <option key={x} value={x}>
                {KINDS[x].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="qv-import-file">File</label>
          <input id="qv-import-file" type="file" accept=".csv,.xlsx,.json,.txt" onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
      </div>
      <p>
        <button type="button" className="btn sm" onClick={() => saveCsv(`${kind}-template.csv`, [k.columns, k.sample])}>
          Download template
        </button>{' '}
        <small>
          Columns: {k.columns.join(', ')}. The second line of the template is an example: replace it.
        </small>
      </p>
      {sheet ? (
        <p role="status">
          <b>{sheet.rows.length}</b> row(s) read from {file}.{missing.length ? ` Columns not in the file (left empty): ${missing.join(', ')}.` : ''}
        </p>
      ) : null}
      {rowErrors.length ? (
        <div className="table-wrap" role="alert">
          <p>Nothing was imported. Correct these rows and choose the file again:</p>
          <table className="register-table plain">
            <thead>
              <tr>
                <th>Row in file</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {rowErrors.map((r) => (
                <tr key={r.row}>
                  <td className="num">{r.row}</td>
                  <td>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}

/** Listens for the page's top "⇧ Import" button and opens the dialog (only when the role may import). */
export function ImportButton({ pageId, kinds, onDone }: { pageId: string; kinds: ImportKind[]; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const allowed = kinds.length > 0;
  useEffect(() => {
    const onImport = (e: Event): void => {
      const { detail } = e as CustomEvent<{ pageId?: string; handled: boolean }>;
      if (detail.pageId !== pageId) return;
      detail.handled = true;
      if (allowed) setOpen(true);
      else toast('Your role cannot import on this page.');
    };
    window.addEventListener('v40-open-import', onImport);
    return () => window.removeEventListener('v40-open-import', onImport);
  }, [pageId, allowed, toast]);
  return open ? <ImportDialog kinds={kinds} onClose={() => setOpen(false)} onDone={onDone} /> : null;
}
