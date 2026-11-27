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
    <div className="attach-docs x-grid-column-1-n1" data-testid="attach-docs">
      <label
        htmlFor={id}
        className="x-d-block x-fs-12px x-fw-600 x-c-textn2 x-mb-5px"
      >
        {label}
      </label>
      <div className="x-d-flex x-gap-10px x-ai-center x-wrap-wrap">
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
        <span className="x-fs-11px x-c-muted">
          Excel (.xlsx .xls .csv) · Word (.docx .doc) · PDF (.pdf) · Text (.txt) — up to{' '}
          {DOC_MAX_MB} MB each
        </span>
      </div>
      {files.length > 0 ? (
        <ul className="x-list-style-none x-m-8px-0-0 x-p-0 x-d-grid x-gap-4px">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="x-d-flex x-ai-center x-gap-8px x-fs-12px x-bg-card2 x-bd-1px-solid-line x-r-6px x-p-4px-8px"
            >
              <span className="chip x-fs-11px">
                {docKind(f.name)}
              </span>
              <span
                className="x-flex-1 x-ov-hidden x-text-overflow-ellipsis x-ws-nowrap"
              >
                {f.name}
              </span>
              <span className="x-c-muted">{kb(f.size)}</span>
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
        <div role="alert" className="x-c-danger-hover x-fs-12px x-mt-6px">
          {problem}
        </div>
      ) : null}
    </div>
  );
}
