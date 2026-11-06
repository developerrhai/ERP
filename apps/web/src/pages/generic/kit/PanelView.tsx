// apps/web/src/pages/generic/kit/PanelView.tsx
// Core renderer for declarative Kit panels and custom registered tabs (docs/plans/07-ENGINE-KIT.md §2.3, §6 KR-04, §12 T-KIT-07)

import { useCallback, useEffect, useState } from 'react';
import { ErrorMessage } from '../../../components/ErrorMessage';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../lib/api';
import type { ActionSet } from '../../../types';
import type { PageSchema, RecordRow, TabPanelRef } from '../engineApi';
import { getRecord } from '../engineApi';
import { getPanel, postCall } from './kitApi';
import { LinesEditor } from './LinesEditor';
import { getPanelComponent } from './panelComponents';
import type { PanelAction, PanelCall, PanelDto, Row } from './panelTypes';
import { BarsSection } from './sections/BarsSection';
import { BoardSection } from './sections/BoardSection';
import { CalendarSection } from './sections/CalendarSection';
import { ChartSection } from './sections/ChartSection';
import { FactsSection } from './sections/FactsSection';
import { FunnelSection } from './sections/FunnelSection';
import { KpiRow } from './sections/KpiRow';
import { NoticeSection } from './sections/NoticeSection';
import { StepperSection } from './sections/StepperSection';
import { TableSection } from './sections/TableSection';
import { TimelineSection } from './sections/TimelineSection';

export interface PanelViewProps {
  pageId: string;
  tab: TabPanelRef;
  recId?: string;
  schema: PageSchema;
  perms?: ActionSet;
  reloadToken?: number;
  onChanged?: () => void;
}

export function PanelView({
  pageId,
  tab,
  recId,
  schema,
  perms,
  reloadToken,
  onChanged,
}: PanelViewProps) {
  const toast = useToast();
  const [panel, setPanel] = useState<PanelDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [confirmDlg, setConfirmDlg] = useState<{ action: PanelAction; row?: Row } | null>(null);
  const [acting, setActing] = useState(false);
  const [record, setRecord] = useState<RecordRow | null>(null);

  // If record-scoped panel but no record selected in the register
  if (tab.scope === 'record' && !recId) {
    return (
      <div className="v9-section" style={{ padding: '32px', textAlign: 'center' }}>
        <p className="muted">Select a record in the register to see its {tab.tab}.</p>
      </div>
    );
  }

  // If tab has a registered custom component
  if (tab.component) {
    const CustomComponent = getPanelComponent(tab.component);
    if (!CustomComponent) {
      return (
        <ErrorMessage>Panel component &quot;{tab.component}&quot; is not registered.</ErrorMessage>
      );
    }
    return (
      <CustomComponent
        pageId={pageId}
        tab={tab}
        recId={recId}
        schema={schema}
        perms={perms}
        reloadToken={reloadToken}
        onChanged={onChanged}
      />
    );
  }

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    if (recId) {
      getRecord(pageId, recId)
        .then((r) => setRecord(r))
        .catch(() => {});
    }
    getPanel(pageId, tab.key, { recId, params: { page } })
      .then((dto) => {
        setPanel(dto);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to load panel.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [pageId, tab.key, recId, page]);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  const executeAction = async (action: PanelAction, row?: Row) => {
    try {
      setActing(true);
      const res = (await postCall(pageId, action.call, {
        recId,
        rowId: row?.id as string | undefined,
      })) as { message?: string } | undefined;

      toast(res?.message ?? `${action.label} completed.`);
      setConfirmDlg(null);
      load();
      onChanged?.();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        toast(err.message);
      } else {
        toast('Action failed.');
      }
    } finally {
      setActing(false);
    }
  };

  const handleAction = (action: PanelAction, row?: Row) => {
    if (action.confirm) {
      setConfirmDlg({ action, row });
      return;
    }
    executeAction(action, row);
  };

  const handleCall = useCallback(
    async (call: PanelCall, opts?: { payload?: Record<string, unknown> }) => {
      const res = await postCall(pageId, call, {
        recId,
        payload: opts?.payload,
      });
      load();
      onChanged?.();
      return res;
    },
    [pageId, recId, load, onChanged],
  );

  if (loading && !panel) {
    return (
      <p className="muted" role="status" style={{ padding: '24px', textAlign: 'center' }}>
        Loading panel…
      </p>
    );
  }

  if (error) {
    return <ErrorMessage onReload={load}>{error}</ErrorMessage>;
  }

  if (!panel) return null;

  return (
    <div className="panel-view" role="region" aria-label={panel.title}>
      {panel.notice ? <NoticeSection tone="info" text={panel.notice} /> : null}

      <div
        className="panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '16px', margin: 0 }}>{panel.title}</h2>
          {panel.subtitle ? (
            <p className="v9-muted" style={{ margin: '4px 0 0' }}>
              {panel.subtitle}
            </p>
          ) : null}
        </div>
        {panel.actions && panel.actions.length > 0 ? (
          <div className="actions" style={{ display: 'flex', gap: '8px' }}>
            {panel.actions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`btn ${a.variant ?? ''}`}
                onClick={() => handleAction(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {panel.kpis && panel.kpis.length > 0 ? <KpiRow kpis={panel.kpis} /> : null}

      <div
        className="panel-sections"
        style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        {panel.sections.map((section, sIdx) => {
          switch (section.type) {
            case 'table':
              return (
                <TableSection
                  key={`table-${sIdx}`}
                  {...section}
                  onAction={(a, row) => handleAction(a, row)}
                  onPageChange={setPage}
                  onCall={handleCall}
                />
              );
            case 'stepper':
              return <StepperSection key={`stepper-${sIdx}`} {...section} />;
            case 'facts':
              return <FactsSection key={`facts-${sIdx}`} {...section} />;
            case 'notice':
              return <NoticeSection key={`notice-${sIdx}`} {...section} />;
            case 'funnel':
              return <FunnelSection key={`funnel-${sIdx}`} {...section} />;
            case 'bars':
              return <BarsSection key={`bars-${sIdx}`} {...section} />;
            case 'chart':
              return <ChartSection key={`chart-${sIdx}`} {...section} />;
            case 'timeline':
              return <TimelineSection key={`timeline-${sIdx}`} {...section} />;
            case 'calendar':
              return <CalendarSection key={`calendar-${sIdx}`} {...section} />;
            case 'board':
              return <BoardSection key={`board-${sIdx}`} {...section} onCall={handleCall} />;
            case 'lines':
              return (
                <LinesEditor
                  key={`lines-${sIdx}`}
                  kind={section.lineKind}
                  record={
                    record ??
                    ({
                      id: recId ?? '',
                      version: 1,
                      status: 'Draft',
                      code: '',
                      data: {},
                    } as RecordRow)
                  }
                  schema={schema}
                  onSaved={() => {
                    load();
                    onChanged?.();
                  }}
                />
              );
            case 'custom': {
              const CustomSection = getPanelComponent(section.component);
              if (!CustomSection) {
                return (
                  <ErrorMessage key={`custom-err-${sIdx}`}>
                    Custom component &quot;{section.component}&quot; is not registered.
                  </ErrorMessage>
                );
              }
              return <CustomSection key={`custom-${sIdx}`} {...section.props} />;
            }
            default:
              return (
                <div key={`section-unsupported-${sIdx}`} className="v9-section">
                  <p className="muted">
                    Section type &quot;{(section as any).type}&quot; not yet loaded.
                  </p>
                </div>
              );
          }
        })}
      </div>

      {confirmDlg ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dlg-title"
        >
          <div className="modal" style={{ maxWidth: '420px', padding: '20px' }}>
            <h3 id="confirm-dlg-title">{confirmDlg.action.label}</h3>
            <p style={{ margin: '12px 0 20px', fontSize: '13px' }}>{confirmDlg.action.confirm}</p>
            <div
              className="actions"
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
            >
              <button
                type="button"
                className="btn"
                disabled={acting}
                onClick={() => setConfirmDlg(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${confirmDlg.action.variant ?? 'primary'}`}
                disabled={acting}
                onClick={() => executeAction(confirmDlg.action, confirmDlg.row)}
              >
                {acting ? 'Working…' : confirmDlg.action.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
