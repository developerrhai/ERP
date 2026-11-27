// apps/web/src/pages/service/TechnicianBoardPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill } from '../finance/shared';
import { serviceApi, type ServiceTicket } from '../../lib/serviceApi';
import { FormModal } from '../mfg/Kit';
import { useToast } from '../../components/Toast';

/** "PUMP_MECH:4, WELD:2" to the API's skill list; a skill without a level counts as level 1. */
function parseSkills(text: string | undefined): Array<{ skillCode: string; level: number }> {
  return (text ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [code = '', lvl] = p.split(':');
      return { skillCode: code.trim().toUpperCase(), level: lvl ? Number(lvl) : 1 };
    });
}
const skillsText = (skills: Array<{ skillCode: string; level: number }> | undefined): string =>
  (skills ?? []).map((k) => `${k.skillCode}:${k.level}`).join(', ');

export function TechnicianBoardPage() {
  const [board, setBoard] = useState<{
    unassignedTickets: ServiceTicket[];
    lanes: Array<{ technician: any; assignedTickets: ServiceTicket[] }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  // null = closed, 'new' = add, otherwise the technician being edited
  const [form, setForm] = useState<null | 'new' | any>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; label: string }>>([]);

  const loadBoard = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await serviceApi.getTechnicianBoard();
      setBoard(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load technician board');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoard();
  }, []);

  const openAdd = async () => {
    setError('');
    try {
      setEmployees(await serviceApi.technicianEmployeeOptions());
      setForm('new');
    } catch (err: any) {
      setError(err.message || 'Could not load the employees.');
    }
  };
  const deactivate = async (tech: any) => {
    setError('');
    try {
      await serviceApi.deactivateTechnician(tech.id);
      toast('Technician deactivated');
      loadBoard();
    } catch (err: any) {
      setError(err.message || 'Could not deactivate the technician.');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Technician Dispatch Board"
        sub="Dispatch lanes per technician with real-time job load, skill levels, and unassigned backlog."
      />

      <div className="x-mb-0_75rem">
        <button type="button" className="btn primary" onClick={() => void openAdd()}>
          + Add technician
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}

      {loading ? (
        <p>Loading technician board...</p>
      ) : board ? (
        <div className="x-d-grid x-cols-300px-1fr x-gap-1_5rem">
          {/* Unassigned Tickets Queue */}
          <div className="x-bg-hfce8e6 x-r-6px x-bd-1px-solid-hfad2cf x-ov-hidden">
            <div className="x-p-0_75rem-1rem x-bg-hfad2cf x-fw-700 x-c-danger-hover">
              Unassigned Backlog ({board.unassignedTickets.length})
            </div>
            <div className="x-p-0_75rem x-d-flex x-fd-column x-gap-0_75rem x-maxh-600px x-ovy-auto">
              {board.unassignedTickets.map((t) => (
                <div key={t.id} className="x-bg-card x-bd-1px-solid-hfad2cf x-r-6px x-p-0_75rem">
                  <div className="x-fw-600 x-c-danger-hover">{t.ticket_no}</div>
                  <div className="x-fs-12px x-mb-0_25rem">{t.subject}</div>
                  <div className="x-fs-11px x-c-muted x-mb-0_5rem">{t.customer_name}</div>
                  <div className="x-fs-11px x-d-flex x-jc-space-between x-ai-center">
                    <span className="badge">P{t.priority}</span>
                    <button
                      className="btn small primary x-p-1px-6px x-fs-11px"
                      onClick={() => serviceApi.autoAssignTicket(t.id).then(loadBoard)}
                    >
                      ⚡ Auto Dispatch
                    </button>
                  </div>
                </div>
              ))}
              {board.unassignedTickets.length === 0 && (
                <p className="x-ta-center x-c-h70757a x-fs-12px x-mt-2rem">
                  No unassigned tickets
                </p>
              )}
            </div>
          </div>

          {/* Technician Lanes */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, board.lanes.length)}, 280px)`, gap: '1rem', overflowX: 'auto' }}>
            {board.lanes.map((lane) => {
              const tech = lane.technician;
              const load = lane.assignedTickets.length;
              const max = tech.maxOpenJobs || 5;
              const isFull = load >= max;

              return (
                <div
                  key={tech.id}
                  className="x-bg-card2 x-bd-1px-solid-line-strong x-r-6px x-ov-hidden x-d-flex x-fd-column"
                >
                  <div className="x-p-0_75rem-1rem x-bg-he8eaed x-bb-1px-solid-line-strong">
                    <div className="x-fw-700">{tech.name}</div>
                    <div className="x-fs-11px x-c-muted x-d-flex x-jc-space-between">
                      <span>{tech.empCode}</span>
                      <span style={{ fontWeight: 600, color: isFull ? '#c5221f' : '#137333' }}>
                        Load: {load}/{max}
                      </span>
                    </div>
                    <div className="x-mt-0_4rem x-d-flex x-gap-0_4rem">
                      <button type="button" className="btn small" onClick={() => setForm(tech)}>
                        Edit
                      </button>
                      <button type="button" className="btn small" onClick={() => void deactivate(tech)}>
                        Deactivate
                      </button>
                    </div>
                  </div>

                  <div className="x-p-0_75rem x-d-flex x-gap-0_75rem x-flex-1 x-maxh-600px x-ovy-auto">
                    {lane.assignedTickets.map((t) => (
                      <div key={t.id} className="x-bg-card x-bd-1px-solid-line-strong x-r-6px x-p-0_75rem">
                        <div className="x-fw-600">{t.ticket_no}</div>
                        <div className="x-fs-12px x-mb-0_25rem">{t.subject}</div>
                        <div className="x-fs-11px x-c-muted x-mb-0_5rem">{t.customer_name}</div>
                        <div className="x-d-flex x-jc-space-between x-ai-center">
                          <Pill tone={t.status === 'IN_PROGRESS' ? 'info' : 'warning'}>{t.status}</Pill>
                          <span className="badge">P{t.priority}</span>
                        </div>
                      </div>
                    ))}
                    {lane.assignedTickets.length === 0 && (
                      <p className="x-ta-center x-c-h70757a x-fs-12px x-mt-2rem">
                        No assigned active jobs
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {form ? (
        <FormModal
          title={form === 'new' ? 'Add technician' : `Edit ${form.name ?? 'technician'}`}
          sub="A technician is an employee of this plant. Skills are written as CODE:level (1 to 5), separated by commas."
          fields={[
            ...(form === 'new'
              ? [{ key: 'employeeId', label: 'Employee', type: 'select' as const, required: true, options: employees }]
              : []),
            { key: 'maxOpenJobs', label: 'Most open jobs at once' },
            { key: 'skills', label: 'Skills (e.g. PUMP_MECH:4, WELD:2)' },
          ]}
          initial={
            form === 'new'
              ? { maxOpenJobs: '5' }
              : { maxOpenJobs: String(form.maxOpenJobs ?? 5), skills: skillsText(form.skills) }
          }
          onClose={() => setForm(null)}
          onSubmit={async (v) => {
            const body = {
              ...(form === 'new' ? { employeeId: v.employeeId } : {}),
              ...(v.maxOpenJobs ? { maxOpenJobs: Number(v.maxOpenJobs) } : {}),
              skills: parseSkills(v.skills),
            };
            if (form === 'new') await serviceApi.createTechnician(body);
            else await serviceApi.updateTechnician(form.id, body);
            toast('Saved');
            setForm(null);
            loadBoard();
          }}
        />
      ) : null}
    </div>
  );
}
