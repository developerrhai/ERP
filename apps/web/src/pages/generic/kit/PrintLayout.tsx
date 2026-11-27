// apps/web/src/pages/generic/kit/PrintLayout.tsx
// Letterhead wrapper and printable layout for document printing (docs/plans/07-ENGINE-KIT.md §2.9, §12 T-KIT-11)

import React, { useEffect } from 'react';
import type { PrintDto, PrintTemplateComponent } from './printRegistry';

export interface PrintLayoutProps {
  dto: PrintDto;
  Component?: PrintTemplateComponent;
  onClose?: () => void;
}

export const PrintLayout: React.FC<PrintLayoutProps> = ({ dto, Component, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print();
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="print-layout x-bg-card x-c-h000 x-p-24px x-font-family-sans-serif"
    >
      {/* Screen toolbar (hidden during actual @media print) */}
      <div
        className="no-print x-d-flex x-jc-space-between x-mb-16px x-bb-1px-solid-hccc x-pb-8px"
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose ?? (() => window.history.back())}
        >
          ✕ Close
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          🖨 Print Now
        </button>
      </div>

      {/* Letterhead Header */}
      <div
        className="print-letterhead x-bb-2px-solid-h000 x-pb-12px x-mb-16px"
      >
        <div className="x-d-flex x-jc-space-between x-ai-flex-start">
          <div>
            <h2 className="x-m-0-0-4px-0 x-fs-20px x-fw-bold">
              {dto.letterhead['companyName'] || 'Sawant Group'}
            </h2>
            <div className="x-fs-12px x-c-h333">
              {dto.letterhead['address'] || dto.unit.address || ''}
            </div>
            {dto.unit.gstin && (
              <div className="x-fs-12px x-fw-600">GSTIN: {dto.unit.gstin}</div>
            )}
            <div className="x-fs-12px x-c-h555">
              Unit: {dto.unit.name} ({dto.unit.code})
            </div>
          </div>
          <div className="x-ta-right">
            <h1
              className="x-m-0-0-6px-0 x-fs-18px x-text-transform-uppercase x-letter-spacing-0_5px"
            >
              {dto.title}
            </h1>
            <div className="x-fs-13px x-fw-bold">Doc No: {dto.docNo}</div>
            <div className="x-fs-12px x-c-h444">Date: {dto.docDate}</div>
            {dto.revision && (
              <div className="x-fs-12px x-c-h666">Rev: {dto.revision}</div>
            )}
          </div>
        </div>
      </div>

      {/* Parties Block */}
      {dto.parties.length > 0 && (
        <div
          className="x-d-flex x-gap-24px x-mb-16px x-bb-1px-solid-line x-pb-12px"
        >
          {dto.parties.map((p, idx) => (
            <div key={idx} className="x-flex-1 x-fs-12px">
              <strong className="x-text-transform-uppercase x-c-h666">{p.role}</strong>
              <div className="x-fw-bold x-fs-13px">{p.name}</div>
              {p.address && <div>{p.address}</div>}
              {p.gstin && <div>GSTIN: {p.gstin}</div>}
              {p.contact && <div>Contact: {p.contact}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Facts Key-Values */}
      {dto.facts.length > 0 && (
        <div
          className="x-d-flex x-wrap-wrap x-gap-16px x-mb-16px x-fs-12px"
        >
          {dto.facts.map((f, idx) => (
            <div key={idx} className="x-minw-140px">
              <span className="x-c-h666">{f.label}: </span>
              <strong>{f.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Custom Component or Default Structured Body */}
      {Component ? (
        <Component dto={dto} />
      ) : (
        <div className="print-body">
          {/* Lines Table */}
          {dto.lines && dto.lines.columns.length > 0 && (
            <table
              className="v9-line-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                marginBottom: '16px',
                fontSize: '12px',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #000', borderTop: '1px solid #000' }}>
                  {dto.lines.columns.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        padding: '6px 8px',
                        textAlign: col.align || 'left',
                        fontWeight: 'bold',
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dto.lines.rows.map((row, rIdx) => (
                  <tr key={rIdx} style={{ borderBottom: '1px solid #eee' }}>
                    {dto.lines!.columns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: '6px 8px',
                          textAlign: col.align || 'left',
                        }}
                      >
                        {String(row[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Totals Block */}
          {dto.totals.length > 0 && (
            <div className="x-d-flex x-jc-flex-end x-mb-16px">
              <div className="x-w-280px x-fs-12px">
                {dto.totals.map((tot, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '4px 0',
                      fontWeight: tot.bold ? 'bold' : 'normal',
                      borderTop: tot.bold ? '1px solid #000' : undefined,
                    }}
                  >
                    <span>{tot.label}</span>
                    <span>{tot.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Amount in words */}
          {dto.amountInWords && (
            <div className="x-fs-12px x-font-style-italic x-mb-16px">
              Amount in words: {dto.amountInWords}
            </div>
          )}

          {/* Sections */}
          {dto.sections.map((sec, idx) => (
            <div key={idx} className="x-mb-14px x-fs-12px">
              <h4 className="x-m-0-0-4px-0 x-fs-13px x-bb-1px-solid-hddd">
                {sec.title}
              </h4>
              {sec.text && <div>{sec.text}</div>}
              {sec.rows && (
                <div className="x-d-flex x-wrap-wrap x-gap-12px x-mt-4px">
                  {sec.rows.map((r, rIdx) => (
                    <div key={rIdx}>
                      <span className="x-c-h666">{r.label}: </span>
                      <span>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Notes */}
          {dto.notes && (
            <div className="x-fs-11px x-c-h444 x-mb-20px">
              <strong>Notes:</strong> {dto.notes}
            </div>
          )}
        </div>
      )}

      {/* Signatures Block */}
      {dto.signatures.length > 0 && (
        <div
          className="x-d-flex x-jc-space-between x-mt-36px x-pt-16px"
        >
          {dto.signatures.map((sig, idx) => (
            <div key={idx} className="x-ta-center x-minw-140px x-fs-12px">
              <div
                className="x-bb-1px-solid-h000 x-mb-4px x-h-32px"
              />
              <strong>{sig.label}</strong>
              {sig.name && <div className="x-c-h555">({sig.name})</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
