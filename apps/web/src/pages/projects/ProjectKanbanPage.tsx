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
      </div>

      {loading ? (
        <p>Loading board...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
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
                      background: isOverWip ? '#f9ab00' : '#bdc1c6',
                      color: isOverWip ? '#202124' : '#fff',
                    }}
                  >
                    {colTasks.length} / {col.limit} WIP
                  </span>
                </div>

                <div style={{ padding: '0.75rem', minHeight: '350px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #dadce0',
                        borderRadius: '4px',
                        padding: '0.75rem',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{t.name}</div>
                      <div style={{ fontSize: '12px', color: '#5f6368', marginBottom: '0.5rem' }}>
                        WBS: {t.wbs_code} • {t.duration_days} days
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                        <span>Progress: {t.progress_pct}%</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {col.key !== 'NOT_STARTED' && (
                            <button
                              className="btn small"
                              style={{ padding: '1px 6px', fontSize: '10px' }}
                              onClick={() => handleProgressChange(t.id, 0)}
                            >
                              ← To Do
                            </button>
                          )}
                          {col.key !== 'IN_PROGRESS' && (
                            <button
                              className="btn small"
                              style={{ padding: '1px 6px', fontSize: '10px' }}
                              onClick={() => handleProgressChange(t.id, 50)}
                            >
                              In Progress
                            </button>
                          )}
                          {col.key !== 'COMPLETED' && (
                            <button
                              className="btn small primary"
                              style={{ padding: '1px 6px', fontSize: '10px' }}
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
                    <p style={{ textAlign: 'center', color: '#70757a', fontSize: '12px', marginTop: '2rem' }}>
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
