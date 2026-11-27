// apps/web/src/pages/projects/ProjectKanbanPage.tsx
import { useEffect, useState } from 'react';
import { PageHead } from '../finance/shared';
import { projectsApi, type Project, type ProjectTask } from '../../lib/projectsApi';

const COLUMNS = [
  { key: 'NOT_STARTED', title: 'To Do', limit: 10 },
  { key: 'IN_PROGRESS', title: 'In Progress', limit: 3 },
  { key: 'COMPLETED', title: 'Completed', limit: 50 },
];

export function ProjectKanbanPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
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

  const loadTasks = async (projectId: string) => {
    try {
      setLoading(true);
      setError('');
      const data = await projectsApi.listTasks(projectId);
      setTasks(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      loadTasks(selectedProjectId);
    }
  }, [selectedProjectId]);

  const handleProgressChange = async (taskId: string, pct: number) => {
    try {
      await projectsApi.updateTaskProgress(taskId, pct);
      if (selectedProjectId) loadTasks(selectedProjectId);
    } catch (err: any) {
      setError(err.message || 'Failed to update task');
    }
  };

  return (
    <div className="page-body">
      <PageHead
        title="Project Kanban"
        sub="Visual task board with column WIP limits, assignee chips, and progress updates."
      />

      {error && <div className="notice error">{error}</div>}

      <div className="x-d-flex x-gap-1rem x-ai-center x-mb-1_5rem">
        <label>Select Project:</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="input x-w-320px"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_no} - {p.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading board...</p>
      ) : (
        <div className="x-d-grid x-cols-repeat-3-1fr x-gap-1_5rem">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.key);
            const isOverWip = colTasks.length > col.limit;

            return (
              <div
                key={col.key}
                style={{
                  background: '#f8f9fa',
                  borderRadius: '6px',
                  border: isOverWip ? '2px solid #f9ab00' : '1px solid #dadce0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    background: isOverWip ? '#fef7e0' : '#e8eaed',
                    borderBottom: '1px solid #dadce0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong style={{ color: isOverWip ? '#b06000' : '#202124' }}>{col.title}</strong>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '10px',
                      background: isOverWip ? '#b45309' : '#5b6980',
                      color: isOverWip ? '#202124' : '#fff',
                    }}
                  >
                    {colTasks.length} / {col.limit} WIP
                  </span>
                </div>

                <div className="x-p-0_75rem x-minh-350px x-d-flex x-fd-column x-gap-0_75rem">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      className="x-bg-card x-bd-1px-solid-line-strong x-r-6px x-p-0_75rem x-box-shadow-0-1px-2px-rgba-0-0-0-0_05"
                    >
                      <div className="x-fw-600 x-mb-0_25rem">{t.name}</div>
                      <div className="x-fs-12px x-c-muted x-mb-0_5rem">
                        WBS: {t.wbs_code} • {t.duration_days} days
                      </div>
                      <div className="x-d-flex x-jc-space-between x-ai-center x-fs-11px">
                        <span>Progress: {t.progress_pct}%</span>
                        <div className="x-d-flex x-gap-4px">
                          {col.key !== 'NOT_STARTED' && (
                            <button
                              className="btn small x-p-1px-6px x-fs-11px"
                              onClick={() => handleProgressChange(t.id, 0)}
                            >
                              ← To Do
                            </button>
                          )}
                          {col.key !== 'IN_PROGRESS' && (
                            <button
                              className="btn small x-p-1px-6px x-fs-11px"
                              onClick={() => handleProgressChange(t.id, 50)}
                            >
                              In Progress
                            </button>
                          )}
                          {col.key !== 'COMPLETED' && (
                            <button
                              className="btn small primary x-p-1px-6px x-fs-11px"
                              onClick={() => handleProgressChange(t.id, 100)}
                            >
                              Done ✓
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <p className="x-ta-center x-c-h70757a x-fs-12px x-mt-2rem">
                      No tasks in this lane
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
