// apps/web/src/pages/projects/ProjectGanttPage.tsx
import { useEffect, useState } from 'react';
import { PageHead } from '../finance/shared';
import { projectsApi, type Project, type ProjectTask } from '../../lib/projectsApi';

export function ProjectGanttPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [ganttData, setGanttData] = useState<{
    projectDurationDays: number;
    criticalPathTaskIds: string[];
    tasks: ProjectTask[];
    dependencies: any[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    projectsApi.list().then((res) => {
      setProjects(res.rows);
      if (res.rows.length > 0 && res.rows[0]) {
        setSelectedProjectId(res.rows[0].id);
      }
    });
  }, []);

  const loadGantt = async (projectId: string) => {
    try {
      setLoading(true);
      setError('');
      const data = await projectsApi.getGantt(projectId);
      setGanttData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load Gantt data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      loadGantt(selectedProjectId);
    }
  }, [selectedProjectId]);

  const maxDays = Math.max(10, ganttData?.projectDurationDays ?? 10);
  const dayWidth = 40;
  const chartWidth = (maxDays + 2) * dayWidth;
  const rowHeight = 36;

  return (
    <div className="page-body">
      <PageHead
        title="Project Gantt & Critical Path"
        sub="CPM schedule calculation with Kahn's topological sort, critical path identification, and baseline tracking."
      />

      {error && <div className="notice error">{error}</div>}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem' }}>
        <label>Select Project:</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="input"
          style={{ width: '320px' }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_no} - {p.name}
            </option>
          ))}
        </select>
        {ganttData && (
          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <span className="badge" style={{ background: '#fad2cf', color: '#c5221f', fontWeight: 'bold' }}>
              Critical Path Duration: {ganttData.projectDurationDays} Days
            </span>
            <span className="badge">
              Critical Tasks: {ganttData.criticalPathTaskIds.length}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <p>Calculating CPM schedule...</p>
      ) : ganttData && ganttData.tasks.length > 0 ? (
        <div style={{ border: '1px solid #dadce0', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', background: '#f8f9fa' }}>
            <div style={{ padding: '0.75rem 1rem', fontWeight: 600, borderRight: '1px solid #dadce0' }}>
              Task (WBS)
            </div>
            <div style={{ overflowX: 'auto', padding: '0.5rem 0' }}>
              <svg width={chartWidth} height={30}>
                {Array.from({ length: maxDays + 1 }).map((_, i) => (
                  <g key={i}>
                    <line x1={i * dayWidth} y1={0} x2={i * dayWidth} y2={30} stroke="#e0e0e0" />
                    <text x={i * dayWidth + 12} y={20} fontSize="11" fill="#70757a">
                      D{i}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', maxHeight: '500px', overflowY: 'auto' }}>
            {/* Task Names List */}
            <div style={{ borderRight: '1px solid #dadce0', background: '#ffffff' }}>
              {ganttData.tasks.map((t) => (
                <div
                  key={t.id}
                  style={{
                    height: `${rowHeight}px`,
                    padding: '0.4rem 1rem',
                    borderBottom: '1px solid #f1f3f4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontWeight: t.isCritical ? 600 : 400, color: t.isCritical ? '#c5221f' : '#202124' }}>
                    {t.name} ({t.duration_days}d)
                  </span>
                  {t.isCritical && <span style={{ fontSize: '10px', color: '#c5221f', fontWeight: 700 }}>CRITICAL</span>}
                </div>
              ))}
            </div>

            {/* SVG Gantt Chart */}
            <div style={{ overflowX: 'auto', background: '#fafafa' }}>
              <svg width={chartWidth} height={ganttData.tasks.length * rowHeight}>
                {/* Vertical grid lines */}
                {Array.from({ length: maxDays + 1 }).map((_, i) => (
                  <line
                    key={i}
                    x1={i * dayWidth}
                    y1={0}
                    x2={i * dayWidth}
                    y2={ganttData.tasks.length * rowHeight}
                    stroke="#eee"
                  />
                ))}

                {/* Task Bars */}
                {ganttData.tasks.map((t, idx) => {
                  const es = t.earlyStart ?? 0;
                  const ef = t.earlyFinish ?? (es + Number(t.duration_days));
                  const x = es * dayWidth;
                  const width = Math.max(4, (ef - es) * dayWidth);
                  const y = idx * rowHeight + 8;
                  const isCrit = t.isCritical;

                  return (
                    <g key={t.id}>
                      {/* Bar */}
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={20}
                        rx={3}
                        fill={isCrit ? '#d93025' : '#1a73e8'}
                      />
                      {/* Label */}
                      <text x={x + 6} y={y + 14} fontSize="10" fill="#ffffff" fontWeight="500">
                        {t.name} ({es}–{ef})
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <p style={{ textAlign: 'center', padding: '2rem' }}>
          No tasks found for this project. Add tasks to see the CPM Gantt chart.
        </p>
      )}
    </div>
  );
}
