// Phase 20-A: Two-process e2e harness: launches TWO independent API processes (5011 + 5012)
// behind an HTTP round-robin reverse proxy (simulating Nginx upstream) on port 5010.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E } from './e2e-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = path.join(root, 'apps', 'api');

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: apiDir, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
}

const baseEnv = {
  ...process.env,
  ...E2E.apiEnv,
  RATE_LIMIT_SHARED: 'true',
  TRUST_PROXY: '1',
};

if (!baseEnv.DATABASE_URL?.endsWith('/rhai_erp_e2e')) {
  throw new Error('Refusing: start-api-cluster must use rhai_erp_e2e');
}

run('npx', ['tsx', 'scripts/reset-test-db.ts'], baseEnv);
run('npx', ['tsx', 'prisma/seed.ts'], baseEnv);

const workers = [
  spawn('npx', ['tsx', 'src/server.ts'], { cwd: apiDir, env: { ...baseEnv, PORT: '5011' }, stdio: 'inherit', shell: true }),
  spawn('npx', ['tsx', 'src/server.ts'], { cwd: apiDir, env: { ...baseEnv, PORT: '5012' }, stdio: 'inherit', shell: true }),
];

const upstreams = ['http://127.0.0.1:5011', 'http://127.0.0.1:5012'];
let idx = 0;

const proxy = http.createServer((req, res) => {
  const target = new URL(upstreams[idx % upstreams.length]);
  idx += 1;
  const headers = {
    ...req.headers,
    'x-forwarded-for': req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '127.0.0.1',
    'x-forwarded-proto': 'http',
  };
  const upstreamReq = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Upstream unavailable');
  });
  req.pipe(upstreamReq);
});

const proxyPort = Number(process.env.CLUSTER_PROXY_PORT || 5010);
proxy.listen(proxyPort, '127.0.0.1', () => {
  console.log(`Two-process API proxy listening on http://127.0.0.1:${proxyPort} -> [5011, 5012]`);
});

const stopAll = () => {
  proxy.close();
  for (const w of workers) w.kill();
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

