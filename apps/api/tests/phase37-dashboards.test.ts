/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// Phase 37 C6: no dashboard endpoint answers 5xx for the owner, whatever the department or module.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { API, XRW, newApp, prisma, signInOwner, unitIds } from './helpers';

describe('Phase 37 C6 - dashboards never answer 5xx', () => {
  const app = newApp();
  it('my / plant / owner / each department / each module', async () => {
    const { token } = await signInOwner(app);
    const [tal = ''] = await unitIds(['TAL']);
    const get = (path: string) =>
      request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', tal).set(XRW);
    const depts = (await prisma.$queryRaw<{ name: string }[]>`SELECT name FROM departments`).map((d) => d.name);
    const paths = ['/dashboards/my', '/dashboards/plant', '/dashboards/owner', '/dashboards/widgets', ...['sales','purchase','inventory','production','quality','finance','hr','maintenance','projects','logistics','service'].map((m) => `/dashboards/module/${m}`), ...depts.map((d) => `/dashboards/dept/${encodeURIComponent(d)}`)];
    const bad: string[] = [];
    for (const p of paths) {
      const r = await get(p);
      if (r.status >= 500) bad.push(`${p} ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    expect(bad).toEqual([]);
  });
});
