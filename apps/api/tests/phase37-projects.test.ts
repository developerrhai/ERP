/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// Phase 37 C5: project-service and project-budget-service write to the real columns.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, XRW, newApp, prisma, signInOwner, unitIds } from './helpers';

describe('Phase 37 C5 - projects, budgets, tasks, expenses on the real columns', () => {
  const app = newApp();
  let token = '';
  let tal = '';
  let projectId = '';
  const call = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app)[method](`${API}/projects${path}`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', tal).set(XRW);

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    [tal = ''] = await unitIds(['TAL']);
  });
  afterAll(async () => {
    if (!projectId) return;
    await prisma.$executeRaw`DELETE FROM task_dependencies WHERE predecessor_id IN (SELECT id FROM project_tasks WHERE project_id = ${projectId}::uuid)`;
    await prisma.$executeRaw`DELETE FROM project_tasks WHERE project_id = ${projectId}::uuid`;
    await prisma.$executeRaw`DELETE FROM project_expenses WHERE project_id = ${projectId}::uuid`;
    await prisma.$executeRaw`DELETE FROM project_budgets WHERE project_id = ${projectId}::uuid`;
    await prisma.$executeRaw`DELETE FROM projects WHERE id = ${projectId}::uuid`;
  });

  it('creates a project (accepts the web form names), budget, approves, activates', async () => {
    const c = await call('post', '/').send({ name: 'P37 project', start_date: '2026-04-01', end_date: '2027-03-31', contract_value: 500000, billing_type: 'TIME_MATERIAL' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    projectId = c.body.data?.id ?? c.body.id;
    expect(projectId).toBeTruthy();
    const proj = c.body.data ?? c.body;
    expect(proj.status).toBe('DRAFT');
    expect(proj.billing_type ?? proj.billingType).toBe('TIME_MATERIAL');

    const noBudget = await call('post', `/${projectId}/activate`);
    expect(noBudget.status).toBe(409);

    const b = await call('post', `/${projectId}/budgets`).send({ lines: [{ costHead: 'LABOUR', amount: 100000 }, { costHead: 'MATERIAL', amount: 200000 }] });
    expect(b.status, JSON.stringify(b.body)).toBeLessThan(300);
    const budget = b.body.data ?? b.body;
    const ap = await call('post', `/budgets/${budget.id}/approve`);
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const act = await call('post', `/${projectId}/activate`);
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect((act.body.data ?? act.body).status).toBe('ACTIVE');
  });

  it('tasks, dependency, progress, gantt and EVM', async () => {
    const t1 = await call('post', `/${projectId}/tasks`).send({ name: 'Design', wbsCode: '1', plannedStart: '2026-04-01', plannedEnd: '2026-04-10', durationDays: 10 });
    expect(t1.status, JSON.stringify(t1.body)).toBe(201);
    const t2 = await call('post', `/${projectId}/tasks`).send({ name: 'Build', wbsCode: '2', plannedStart: '2026-04-11', plannedEnd: '2026-04-30', durationDays: 20 });
    const id1 = (t1.body.data ?? t1.body).id;
    const id2 = (t2.body.data ?? t2.body).id;
    const dep = await request(app).post(`${API}/projects/tasks/${id2}/dependencies`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', tal).set(XRW).send({ successorId: id1, type: 'FS' });
    expect(dep.status, JSON.stringify(dep.body)).toBeLessThan(300);
    const pr = await request(app).patch(`${API}/projects/tasks/${id1}/progress`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', tal).set(XRW).send({ progressPct: 100 });
    expect(pr.status, JSON.stringify(pr.body)).toBe(200);
    expect((pr.body.data ?? pr.body).status).toBe('DONE');
    const g = await call('get', `/${projectId}/gantt`);
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const evm = await call('get', `/${projectId}/evm`);
    expect(evm.status, JSON.stringify(evm.body)).toBe(200);
  });

  it('expense: header + line, approve', async () => {
    const e = await call('post', `/${projectId}/expenses`).send({ category: 'TRAVEL', amount: 1000, taxAmount: 50, description: 'Site visit' });
    expect(e.status, JSON.stringify(e.body)).toBeLessThan(300);
    const exp = e.body.data ?? e.body;
    expect(Number(exp.amount)).toBe(1000);
    expect(exp.category).toBe('TRAVEL');
    const ap = await request(app).post(`${API}/projects/expenses/${exp.id}/approve`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', tal).set(XRW);
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const list = await call('get', `/${projectId}/expenses`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const bva = await call('get', `/${projectId}/budget-vs-actual`);
    expect(bva.status, JSON.stringify(bva.body)).toBe(200);
    const prof = await call('get', `/${projectId}/profitability`);
    expect(prof.status, JSON.stringify(prof.body)).toBe(200);
  });
});
