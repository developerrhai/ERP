// Phase 20-A Multi-process verification: spawns TWO real independent OS processes (`server.ts` on
// ports 5111 & 5112 against `rhai_erp_test` with shared Postgres rate-limit + LISTEN/NOTIFY cache bus)
// and proves:
//   1. Permission update via Process A propagates to Process B via LISTEN erp_cache in < 2s.
//   2. Login rate limit (5/min) counts cumulatively across Process A and Process B.
//   3. Mutating command with Idempotency-Key succeeds on Process A and replays cleanly on Process B.
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, makeUser, prisma } from './helpers';
import { TEST_ENV, TEST_OWNER } from './test-env';

const require = createRequire(import.meta.url);
const apiDir = path.resolve(__dirname, '..');
const compiledServer = path.join(apiDir, 'dist', 'server.js');
const tsxCli = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

const PORT_A = 5111;
const PORT_B = 5112;
const URL_A = `http://127.0.0.1:${PORT_A}/api/v1`;
const URL_B = `http://127.0.0.1:${PORT_B}/api/v1`;

let procA: ChildProcess;
let procB: ChildProcess;

function startWorker(port: number): ChildProcess {
  const fs = require('node:fs') as typeof import('node:fs');
  const args = fs.existsSync(compiledServer) ? [compiledServer] : [tsxCli, 'src/server.ts'];
  const child = spawn(process.execPath, args, {
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...TEST_ENV,
      PORT: String(port),
      RATE_LIMIT_DISABLED: 'false',
      RATE_LIMIT_SHARED: 'true',
      TRUST_PROXY: '1',
      LOG_LEVEL: 'error',
    },
  });
  child.stderr?.on('data', (d) => {
    const text = String(d).trim();
    if (text) console.error(`[worker:${port}]`, text);
  });
  return child;
}

async function waitReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/health/ready`);
      if (r.status === 200) {
        const body = (await r.json()) as { data?: { status?: string; checks?: { cacheBus?: { connected?: boolean } } } };
        if (body.data?.status === 'ready' && body.data?.checks?.cacheBus?.connected) return;
      }
    } catch {
      // retry until ready
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Worker at ${baseUrl} did not become ready within 20s`);
}

describe('Phase 20-A Two-Process API Cluster Readiness', () => {
  beforeAll(async () => {
    procA = startWorker(PORT_A);
    procB = startWorker(PORT_B);
    await Promise.all([waitReady(URL_A), waitReady(URL_B)]);
  }, 45_000);

  afterAll(async () => {
    procA?.kill();
    procB?.kill();
  });

  it('shares rate limits, replays Idempotency-Key across processes, and syncs permission invalidations in < 2s', async () => {
    const loginRes = await fetch(`${URL_A}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ identifier: TEST_OWNER.loginId, password: TEST_OWNER.password }),
    });
    expect(loginRes.status).toBe(200);
    const accessToken = ((await loginRes.json()) as { data: { accessToken: string } }).data.accessToken;

    const unit = await prisma.unit.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const fy = await prisma.financialYear.findFirstOrThrow({ where: { isCurrent: true } });
    const headersA = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Unit-Id': unit.id,
      'X-FY-Id': fy.id,
    };

    // 1. Idempotency replay across Process A -> Process B
    const dryRes = await fetch(`${URL_A}/hardening/cutover/dry-run`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        dataset: 'GL_TRIAL',
        legacyTotal: 5000,
        rows: [
          { accountCode: '1101', debit: 5000, credit: 0 },
          { accountCode: '3009', debit: 0, credit: 5000 },
        ],
      }),
    });
    expect(dryRes.status).toBe(201);
    const batchId = ((await dryRes.json()) as { data: { id: string } }).data.id;

    const idemKey = `mp-replay-${Date.now()}`;
    const cA = await fetch(`${URL_A}/hardening/cutover/${batchId}/commit`, {
      method: 'POST',
      headers: { ...headersA, 'Idempotency-Key': idemKey },
    });
    expect(cA.status).toBe(200);

    const cB = await fetch(`${URL_B}/hardening/cutover/${batchId}/commit`, {
      method: 'POST',
      headers: { ...headersA, 'Idempotency-Key': idemKey },
    });
    expect(cB.status).toBe(200);
    expect(cB.headers.get('idempotent-replay')).toBe('true');

    // 2. Shared Postgres rate limit across Process A (3 hits) + Process B (2 hits) -> 6th hit returns 429
    const limitedId = `mp-ratelimit-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      const targetUrl = i % 2 === 0 ? URL_A : URL_B;
      const r = await fetch(`${targetUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ identifier: limitedId, password: 'Wrong-Passw0rd!' }),
      });
      expect(r.status).toBe(401);
    }
    const blockedOnB = await fetch(`${URL_B}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': '203.0.113.55',
      },
      body: JSON.stringify({ identifier: limitedId, password: 'Wrong-Passw0rd!' }),
    });
    expect(blockedOnB.status).toBe(429);

    // 3. Cross-process cache invalidation (< 2s) via module-control toggle on Process A observed on Process B
    const mgrUser = await makeUser({ role: 'DIRECTOR', loginId: `mp-dir-${Date.now()}` });
    const mgrLogin = await fetch(`${URL_B}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ identifier: mgrUser.loginId, password: PASSWORD }),
    });
    expect(mgrLogin.status).toBe(200);
    const mgrToken = ((await mgrLogin.json()) as { data: { accessToken: string } }).data.accessToken;

    // Warm Process B access cache for mgrUser
    const warmB = await fetch(`${URL_B}/me/permissions?pageId=crm-leads`, {
      headers: { Authorization: `Bearer ${mgrToken}` },
    });
    expect(warmB.status).toBe(200);
    const beforeCtrl = (await warmB.json()) as { data: { actions: { view: boolean } } };
    expect(beforeCtrl.data.actions.view).toBe(true);

    const mc = await prisma.moduleControl.findUniqueOrThrow({ where: { pageId: 'crm-leads' } });

    // Toggle crm-leads disabled on Process A (PATCH /module-controls/:pageId)
    const patchRes = await fetch(`${URL_A}/module-controls/crm-leads`, {
      method: 'PATCH',
      headers: { ...headersA, 'If-Match': String(mc.version) },
      body: JSON.stringify({ enabled: !mc.enabled }),
    });
    expect(patchRes.status).toBe(200);

    // Poll Process B: must reflect toggled state via LISTEN erp_cache within < 2000ms
    let updatedSeen = false;
    const startPoll = Date.now();
    while (Date.now() - startPoll < 2000) {
      const probeB = await fetch(`${URL_B}/me/permissions?pageId=crm-leads`, {
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      const bodyB = (await probeB.json()) as { data: { actions: { view: boolean } } };
      if (bodyB.data.actions.view !== beforeCtrl.data.actions.view) {
        updatedSeen = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(updatedSeen).toBe(true);

    // Restore module control cleanly
    const mcNow = await prisma.moduleControl.findUniqueOrThrow({ where: { pageId: 'crm-leads' } });
    await fetch(`${URL_A}/module-controls/crm-leads`, {
      method: 'PATCH',
      headers: { ...headersA, 'If-Match': String(mcNow.version) },
      body: JSON.stringify({ enabled: mc.enabled }),
    });
  }, 30_000);
});

