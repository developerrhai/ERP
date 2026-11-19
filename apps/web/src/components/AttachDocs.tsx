// "Attach Documents (+ Upload File)" field of every Add / Edit modal (QA ERP-DOC-01): Excel, Word, PDF and Text files
// are picked here, checked (type and size) and listed with a remove button. The owner of the modal decides what to do
// with the files on save (upload them to the record, or keep their names on the row).
import { useId, useRef, useState } from 'react';

/** The four formats the QA asks for: Excel (.xlsx/.xls/.csv), Word (.docx/.doc), PDF (.pdf) and Text (.txt). */
export const DOC_ACCEPT = '.xlsx,.xls,.csv,.docx,.doc,.pdf,.txt';
const DOC_EXT = /\.(xlsx|xls|csv|docx|doc|pdf|txt)$/i;
export const DOC_MAX_MB = 10;
export const DOC_MAX_FILES = 10;

/** Why a file cannot be attached (undefined = fine). */
export function attachError(file: { name: string; size: number }): string | undefined {
  if (!DOC_EXT.test(file.name))
    return `${file.name}: only Excel (.xlsx/.xls/.csv), Word (.docx/.doc), PDF (.pdf) and Text (.txt) files can be attached.`;
  if (file.size > DOC_MAX_MB * 1024 * 1024) return `${file.name}: larger than ${DOC_MAX_MB} MB.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  return undefined;
}

/** Short type label of a file name, for the list ("Excel", "Word", "PDF", "Text"). */
export function docKind(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'Excel';
  if (['docx', 'doc'].includes(ext)) return 'Word';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'txt') return 'Text';
  return 'File';
}

const kb = (n: number): string =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

export function AttachDocs({
  files,
  onChange,
  label = 'Attach Documents',
  buttonLabel = '+ Upload File',
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  buttonLabel?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');

  const pick = (list: FileList | null): void => {
    if (!list) return;
    const next = [...files];
    const problems: string[] = [];
    for (const f of Array.from(list)) {
      const why = attachError(f);
      if (why) problems.push(why);
      else if (next.length >= DOC_MAX_FILES)
        problems.push(`At most ${DOC_MAX_FILES} files can be attached.`);
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setProblem(problems.join(' '));
    onChange(next);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="attach-docs" data-testid="attach-docs" style={{ gridColumn: '1 / -1' }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: '#334155',
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn sm" onClick={() => input.current?.click()}>
          {buttonLabel}
        </button>
        <input
          id={id}
          ref={input}
          type="file"
          multiple
          accept={DOC_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => pick(e.target.files)}
          aria-label={label}
        />
        <span style={{ fontSize: 11, color: '#64748b' }}>
          Excel (.xlsx .xls .csv) · Word (.docx .doc) · PDF (.pdf) · Text (.txt) — up to{' '}
          {DOC_MAX_MB} MB each
        </span>
      </div>
      {files.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '4px 8px',
              }}
            >
              <span className="chip" style={{ fontSize: 10 }}>
                {docKind(f.name)}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {f.name}
              </span>
              <span style={{ color: '#64748b' }}>{kb(f.size)}</span>
              <button
                type="button"
                className="btn sm"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <div role="alert" style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>
          {problem}
        </div>
      ) : null}
    </div>
  );
}
