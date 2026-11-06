import React, { useState, useRef, useEffect } from 'react';
import type { PrintTemplateRef } from '../engineApi';
import { PrintLayout } from './PrintLayout';
import { getPrintTemplate, type PrintDto } from './printRegistry';

export interface PrintMenuProps {
  pageId: string;
  recordId?: string;
  templates?: PrintTemplateRef[];
  buttonLabel?: string;
  className?: string;
}

export const PrintMenu: React.FC<PrintMenuProps> = ({
  pageId,
  recordId,
  templates = [],
  buttonLabel = 'Print ▾',
  className = 'btn btn-secondary',
}) => {
  const [open, setOpen] = useState(false);
  const [activeDto, setActiveDto] = useState<PrintDto | null>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Filter templates: if recordId is provided, include scope !== 'page'; if no recordId, include scope === 'page'
  const visibleTemplates = templates.filter((t) => {
    if (recordId) {
      return t.scope !== 'page';
    }
    return t.scope === 'page';
  });

  if (visibleTemplates.length === 0) {
    return null;
  }

  const handleSelect = async (tmpl: PrintTemplateRef) => {
    setOpen(false);
    if (tmpl.kind === 'pdf') {
      const url = recordId
        ? `/api/v1/pages/${pageId}/records/${recordId}/pdf/${tmpl.key}`
        : `/api/v1/pages/${pageId}/pdf/${tmpl.key}`;
      window.open(url, '_blank');
    } else {
      // kind === 'web'
      try {
        setLoading(true);
        const url = recordId
          ? `/api/v1/pages/${pageId}/records/${recordId}/print/${tmpl.key}`
          : `/api/v1/pages/${pageId}/print/${tmpl.key}`;
        const res = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          throw new Error(`Failed to load print data: ${res.statusText}`);
        }
        const data = await res.json();
        setActiveDto(data.data);
      } catch (err: any) {
        alert(err.message || 'Error loading print template');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div
      className="print-menu-wrap"
      style={{ position: 'relative', display: 'inline-block' }}
      ref={menuRef}
    >
      <button
        type="button"
        className={className}
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {loading ? 'Loading…' : buttonLabel}
      </button>

      {open && (
        <div
          className="dropdown-menu"
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            background: 'var(--panel-bg, #fff)',
            border: '1px solid var(--border-color, #ccc)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: '180px',
            padding: '4px 0',
          }}
        >
          {visibleTemplates.map((t) => (
            <button
              key={t.key}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(t)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                background: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'inherit',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--hover-bg, #f3f4f6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span style={{ marginRight: '8px' }}>{t.kind === 'pdf' ? '📄' : '🖨'}</span>
              <span>{t.label}</span>
              {t.kind === 'pdf' && (
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#888' }}>PDF</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Render print view modal when web template dto is loaded */}
      {activeDto && (
        <div
          className="print-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            overflowY: 'auto',
            padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: '900px',
              margin: '0 auto',
              background: '#fff',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
              borderRadius: '6px',
            }}
          >
            <PrintLayout
              dto={activeDto}
              Component={getPrintTemplate(pageId, activeDto.templateKey)}
              onClose={() => setActiveDto(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
