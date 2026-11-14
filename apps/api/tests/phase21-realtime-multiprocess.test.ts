// Phase 21 §5.3 & §10 Multi-process SSE Real-Time Verification:
// Spawns TWO independent OS API processes (ports 5115 & 5116 against `rhai_erp_test`)
// connected via PostgreSQL `LISTEN erp_rt`:
//   1. Client opens SSE stream `/api/v1/realtime/stream` on Process B.
//   2. Process A sends an admin test notification -> commits transaction -> pg_notify('erp_rt').
//   3. Process B delivers `event: notification.new` + `event: badge` to client in < 2s.
//   4. Reconnecting with `Last-Event-ID` replays missed notifications without gap.
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, makeUser, prisma } from './helpers';
import { TEST_ENV } from './test-env';

const require = createRequire(__filename);
const apiDir = path.resolve(__dirname, '..');
const compiledServer = path.join(apiDir, 'dist', 'server.js');
const tsxCli = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

const PORT_A = 5115;
const PORT_B = 5116;
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
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/health/ready`);
      if (r.ok) return;
    } catch {
      // booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Worker at ${baseUrl} did not become ready in time`);
}

async function loginWorker(baseUrl: string, identifier: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'rhai-web' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`Login failed on ${baseUrl}: ${JSON.stringify(body)}`);
  return body.data.accessToken as string;
}

beforeAll(async () => {
  procA = startWorker(PORT_A);
  procB = startWorker(PORT_B);
  await Promise.all([waitReady(URL_A), waitReady(URL_B)]);
}, 40_000);

afterAll(async () => {
  procA?.kill('SIGTERM');
  procB?.kill('SIGTERM');
  await prisma.$disconnect();
});

describe('Phase 21 Multi-process SSE real-time fan-out via LISTEN erp_rt', () => {
  it('delivers Process A notify() to Process B SSE stream in < 2s and replays via Last-Event-ID', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const tokenA = await loginWorker(URL_A, admin.loginId, PASSWORD);
    const tokenB = await loginWorker(URL_B, admin.loginId, PASSWORD);

    // Open SSE stream on Process B
    const ctrl = new AbortController();
    const sseResp = await fetch(`${URL_B}/realtime/stream`, {
      headers: { Authorization: `Bearer ${tokenB}` },
      signal: ctrl.signal,
    });
    expect(sseResp.status).toBe(200);
    expect(sseResp.headers.get('content-type')).toContain('text/event-stream');

    const reader = sseResp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events: string[] = [];

    const readLoop = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const f of frames) {
            if (f.trim()) events.push(f);
          }
        }
      } catch {
        // Expected on AbortController abort
      }
    })();

    // Give Process B brief moment to send initial badge frame
    await new Promise((r) => setTimeout(r, 200));
    const countBefore = events.length;

    // Trigger notification in Process A
    const t0 = Date.now();
    const testRes = await fetch(`${URL_A}/admin/notification-types/APPROVAL_ASSIGNED/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'X-Requested-With': 'rhai-web' },
    });
    expect(testRes.status).toBe(200);

    // Poll local frames array for up to 2000ms for `notification.new`
    let arrived: string | undefined;
    while (Date.now() - t0 < 2000) {
      arrived = events.slice(countBefore).find((f) => f.includes('event: notification.new'));
      if (arrived) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    ctrl.abort();
    await readLoop;

    expect(
      arrived,
      `Expected notification.new over SSE from Process A->B within 2s, got: ${events.join(' | ')}`,
    ).toBeTruthy();

    // Verify Last-Event-ID replay works by reconnecting with Last-Event-ID: 0
    const ctrl2 = new AbortController();
    const replayResp = await fetch(`${URL_B}/realtime/stream`, {
      headers: { Authorization: `Bearer ${tokenB}`, 'Last-Event-ID': '0' },
      signal: ctrl2.signal,
    });
    expect(replayResp.status).toBe(200);
    const reader2 = replayResp.body!.getReader();
    const chunk = await reader2.read();
    const replayText = decoder.decode(chunk.value ?? new Uint8Array());
    ctrl2.abort();
    expect(replayText).toContain('event: notification.new');
  }, 30_000);
});
