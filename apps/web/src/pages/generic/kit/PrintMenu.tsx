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
      className="print-menu-wrap x-pos-relative x-d-inline-block"
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
          className="dropdown-menu x-pos-absolute x-top-100pct x-left-0 x-mt-4px x-bg-var-panel-bg-hfff x-bd-1px-solid-var-border-color-hccc x-r-6px x-box-shadow-0-4px-12px-rgba-0-0-0-0_15 x-z-index-1000 x-minw-180px x-p-4px-0"
          role="menu"
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
              <span className="x-mr-8px">{t.kind === 'pdf' ? '📄' : '🖨'}</span>
              <span>{t.label}</span>
              {t.kind === 'pdf' && (
                <span className="x-ml-auto x-fs-11px x-c-h888">PDF</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Render print view modal when web template dto is loaded */}
      {activeDto && (
        <div
          className="print-modal-overlay x-pos-fixed x-inset-0 x-z-index-9999 x-bg-rgba-0-0-0-0_6 x-ovy-auto x-p-20px"
        >
          <div
            className="x-maxw-900px x-m-0-auto x-bg-card x-box-shadow-0-8px-30px-rgba-0-0-0-0_3 x-r-6px"
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
