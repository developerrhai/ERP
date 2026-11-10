// Phase 20-A & 20-K (§4.5): PM2 two fork-mode workers behind Nginx upstream (keepalive 16).
// Never use cluster mode with Prisma/pg-boss native pools; two independent fork processes erp-a & erp-b
// ensure zero-downtime rolling reloads gated by /api/v1/health/ready.
module.exports = {
  apps: [
    {
      name: 'erp-a',
      cwd: '/app/sawant-erp/current/apps/api',
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '700M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production',
        PORT: 5011,
        TRUST_PROXY: '2',
        HEALTH_REQUIRE_JOBS: 'true',
      },
    },
    {
      name: 'erp-b',
      cwd: '/app/sawant-erp/current/apps/api',
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '700M',
      kill_timeout: 15000,
      listen_timeout: 10000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production',
        PORT: 5012,
        TRUST_PROXY: '2',
        HEALTH_REQUIRE_JOBS: 'true',
      },
    },
  ],
};

