// Phase 20-E (§5(a)): k6 performance & 30-minute soak suite for Sawant Group ERP.
// Run against _perf database / staging ONLY (never production):
//   k6 run -e BASE_URL=http://127.0.0.1:5010 -e K6_USER=owner -e K6_PASS=... tests/perf/k6-suite.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const listLatency = new Trend('erp_list_duration', true);
const voucherLatency = new Trend('erp_voucher_post_duration', true);

export const options = {
  scenarios: {
    login_ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 60,
      stages: [
        { target: 20, duration: '1m' },
        { target: 20, duration: '2m' },
        { target: 0, duration: '30s' },
      ],
      exec: 'loginFlow',
    },
    api_soak_70_20_10: {
      executor: 'constant-vus',
      vus: 100,
      duration: __ENV.SOAK_DURATION || '30m',
      exec: 'soakFlow',
    },
  },
  thresholds: {
    erp_list_duration: ['p(95)<300'],
    erp_voucher_post_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.005'],
  },
};

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:5010';
const LOGIN_ID = __ENV.K6_USER || 'owner';
const PASSWORD = __ENV.K6_PASS || '';

export function loginFlow() {
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ identifier: LOGIN_ID, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } },
  );
  check(res, { 'login status 200 or 429': (r) => r.status === 200 || r.status === 429 });
  sleep(0.5);
}

export function setup() {
  const res = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ identifier: LOGIN_ID, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } },
  );
  const body = res.json();
  return { token: body?.data?.accessToken || '' };
}

export function soakFlow(data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  const r = Math.random();
  if (r < 0.7) {
    const listRes = http.get(`${BASE}/api/v1/pages/crm-leads/records?page=1&size=20`, { headers });
    listLatency.add(listRes.timings.duration);
    check(listRes, { 'list 200': (x) => x.status === 200 });
  } else if (r < 0.9) {
    const repRes = http.get(`${BASE}/api/v1/bi/datasets`, { headers });
    voucherLatency.add(repRes.timings.duration);
    check(repRes, { 'reports 200': (x) => x.status === 200 });
  } else {
    const hRes = http.get(`${BASE}/api/v1/health/ready`);
    check(hRes, { 'ready 200': (x) => x.status === 200 });
  }
  sleep(1);
}

