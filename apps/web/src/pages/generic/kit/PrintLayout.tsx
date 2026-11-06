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
      className="print-layout"
      style={{ background: '#fff', color: '#000', padding: '24px', fontFamily: 'sans-serif' }}
    >
      {/* Screen toolbar (hidden during actual @media print) */}
      <div
        className="no-print"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '16px',
          borderBottom: '1px solid #ccc',
          paddingBottom: '8px',
        }}
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
        className="print-letterhead"
        style={{ borderBottom: '2px solid #000', paddingBottom: '12px', marginBottom: '16px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 'bold' }}>
              {dto.letterhead['companyName'] || 'Sawant Group'}
            </h2>
            <div style={{ fontSize: '12px', color: '#333' }}>
              {dto.letterhead['address'] || dto.unit.address || ''}
            </div>
            {dto.unit.gstin && (
              <div style={{ fontSize: '12px', fontWeight: '600' }}>GSTIN: {dto.unit.gstin}</div>
            )}
            <div style={{ fontSize: '12px', color: '#555' }}>
              Unit: {dto.unit.name} ({dto.unit.code})
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1
              style={{
                margin: '0 0 6px 0',
                fontSize: '18px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {dto.title}
            </h1>
            <div style={{ fontSize: '13px', fontWeight: 'bold' }}>Doc No: {dto.docNo}</div>
            <div style={{ fontSize: '12px', color: '#444' }}>Date: {dto.docDate}</div>
            {dto.revision && (
              <div style={{ fontSize: '12px', color: '#666' }}>Rev: {dto.revision}</div>
            )}
          </div>
        </div>
      </div>

      {/* Parties Block */}
      {dto.parties.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '24px',
            marginBottom: '16px',
            borderBottom: '1px solid #eee',
            paddingBottom: '12px',
          }}
        >
          {dto.parties.map((p, idx) => (
            <div key={idx} style={{ flex: 1, fontSize: '12px' }}>
              <strong style={{ textTransform: 'uppercase', color: '#666' }}>{p.role}</strong>
              <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{p.name}</div>
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
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '16px',
            fontSize: '12px',
          }}
        >
          {dto.facts.map((f, idx) => (
            <div key={idx} style={{ minWidth: '140px' }}>
              <span style={{ color: '#666' }}>{f.label}: </span>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <div style={{ width: '280px', fontSize: '12px' }}>
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
            <div style={{ fontSize: '12px', fontStyle: 'italic', marginBottom: '16px' }}>
              Amount in words: {dto.amountInWords}
            </div>
          )}

          {/* Sections */}
          {dto.sections.map((sec, idx) => (
            <div key={idx} style={{ marginBottom: '14px', fontSize: '12px' }}>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', borderBottom: '1px solid #ddd' }}>
                {sec.title}
              </h4>
              {sec.text && <div>{sec.text}</div>}
              {sec.rows && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px' }}>
                  {sec.rows.map((r, rIdx) => (
                    <div key={rIdx}>
                      <span style={{ color: '#666' }}>{r.label}: </span>
                      <span>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Notes */}
          {dto.notes && (
            <div style={{ fontSize: '11px', color: '#444', marginBottom: '20px' }}>
              <strong>Notes:</strong> {dto.notes}
            </div>
          )}
        </div>
      )}

      {/* Signatures Block */}
      {dto.signatures.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '36px',
            paddingTop: '16px',
          }}
        >
          {dto.signatures.map((sig, idx) => (
            <div key={idx} style={{ textAlign: 'center', minWidth: '140px', fontSize: '12px' }}>
              <div
                style={{ borderBottom: '1px solid #000', marginBottom: '4px', height: '32px' }}
              />
              <strong>{sig.label}</strong>
              {sig.name && <div style={{ color: '#555' }}>({sig.name})</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
