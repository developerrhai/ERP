# Deployment review — Vercel + EC2 (2026-11-02)

**Scope.** I reviewed `vercel.json`, `apps/web/vercel.json`, `deploy_to_ec2.example.ps1`, the git-ignored `deploy_to_ec2.ps1` (secrets masked while reading), commit `5216398` (CORS + API base) and the published login message.

**Nothing was deployed or pushed during this review** (see `CLAUDE.md`).

## How it is wired today
```
Browser ──► https://erp-taupe-delta.vercel.app  (static React build)
              │  /api/*  (Vercel rewrite)
              ▼
        https://institute-api.rhaitech.online/sawant-erp/api/*   (Nginx on EC2, shared with another app)
              │  location /sawant-erp/ → proxy_pass http://localhost:5010
              ▼
        Node API (pm2 "sawant-erp-backend", /app/sawant-erp-backend) ──► PostgreSQL
```
Because of the Vercel rewrite, the browser sees the API as **same-origin**. That is good: the `SameSite=Strict` refresh cookie works, and CORS is not needed for the real app.

## Findings, most urgent first

| # | Severity | Finding | What to do |
|---|---|---|---|
| D1 | **Critical** | **A GitHub personal access token is stored in plain text in the git remote URLs** of this folder (`origin` and `erp-old`). Anyone who gets a copy of this folder, or of a screenshot of `git remote -v`, can push to your GitHub | Revoke that token on GitHub (Settings → Developer settings → Tokens). Then `git remote set-url origin https://github.com/developerrhai/first-erp.git` and use Git Credential Manager |
| D2 | **Critical** | **Production passwords were published in a chat message:** the owner, the admin and all 10 department accounts. The department accounts all share one weak password | Change every one of these passwords now. Give each person their own account with a temporary password; the system forces them to change it at first sign-in. Do not share one login per department, because the audit trail then cannot tell who did what |
| D3 | High | The production JWT signing secret in `deploy_to_ec2.ps1` is a readable phrase, not a random value. Anyone who guesses it could forge access tokens. The session check limits the damage, but this must be fixed. With the current code it is also too short for production (the API requires ≥ 48 characters there) | Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, put it in the server `.env`, restart. Rotating it signs everyone out once; that is expected |
| D4 | High | **The deploy never runs database migrations** (`prisma migrate deploy` is missing). New tables from a phase (for example the Phase 2 permissions and departments) are not created on the server, so new features fail in production | Add `npx prisma migrate deploy` before the pm2 restart (done in the example script) |
| D5 | High | **CORS was opened to any origin containing `localhost` or ending in `.vercel.app`, with credentials** (commit `5216398`). An attacker's site such as `evil-localhost.com` passes the check | Being replaced by an exact allow-list (`WEB_ORIGINS`) in the current fix loop. It is not needed for the Vercel setup anyway (same-origin) |
| D6 | Medium | **The Nginx block does not forward the client IP** (`X-Forwarded-For`, `X-Forwarded-Proto`). With two proxies (Vercel → Nginx), the API sees every user as `127.0.0.1`, so login rate limits are shared by everyone. One person typing wrong passwords can block logins for the whole company. The audit trail also shows no real IPs | Add the headers below, and set `TRUST_PROXY=2` in the server `.env` |
| D7 | Medium | `ssh/scp -o StrictHostKeyChecking=no` accepts any server key, so a man-in-the-middle would go unnoticed | Use `StrictHostKeyChecking=accept-new` (done in the example script) |
| D8 | Medium | **No check after deploy.** pm2 can report "online" while the API crash-loops, and there is no rollback | The example script now calls `/api/v1/health` after restart and fails loudly if it is not OK. Keep the previous `dist/` as `dist.prev` for a quick rollback |
| D9 | Medium | The server `.env` is written only **if it does not exist**, from values hard-coded in the script, so later changes to the script never reach the server. The superadmin password also lives in that script | Keep the server `.env` as the single source of truth and edit it on the server. Remove the secrets from the script |
| D10 | Low | The live `.env` uses `CORS_ORIGINS`, but the API reads `WEB_ORIGIN` | The fix loop accepts all three names (`WEB_ORIGINS`, `WEB_ORIGIN`, `CORS_ORIGINS`) |
| D11 | Low | The frontend and backend deploy separately: Vercel builds the frontend on every push, while the backend deploys by hand. A pushed frontend can expect API endpoints the server does not have yet | Deploy the backend first, then push the frontend. Or turn off automatic Vercel deploys until both are ready |
| D13 | High | `prisma` is a dev-only dependency. On the server (`npm install --omit=dev`), `npx prisma generate` downloads the **latest** Prisma, not the 5.22.0 the app is built with. A major version mismatch can break the client or the migrations | The example script now pins the version from `package.json` (`npx prisma@<version>`) |
| D12 | Info | The Nginx config is shared with another app (`institute-api.rhaitech.online`), and the script edits it with `sed` | Keep a dated backup before editing (`cp myapp.conf myapp.conf.$(date +%F)`); the script currently restores a `.bak` it never creates |

## Recommended Nginx block (replaces the current `/sawant-erp/` location)
```nginx
location /sawant-erp/ {
    rewrite ^/sawant-erp/(.*) /$1 break;
    proxy_pass http://127.0.0.1:5010;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 30m;   # document uploads in later phases
}
```

## Server `.env` checklist (values stay on the server, never in git or chat)
```
NODE_ENV=production
PORT=5010
DATABASE_URL=<redacted>
JWT_ACCESS_SECRET=<48+ random characters>
WEB_ORIGINS=https://erp-taupe-delta.vercel.app
TRUST_PROXY=2
SUPERADMIN_LOGIN_ID / SUPERADMIN_EMAIL / SUPERADMIN_NAME / SUPERADMIN_PASSWORD  (only needed until the owner exists)
```

## Safe deploy order (manual, by the owner)
1. Run `npm run verify` and `npm run e2e` locally. Both must be green.
2. Back up the production DB: `pg_dump -Fc` to a dated file.
3. Deploy the backend with the updated script. It builds, uploads, runs `prisma migrate deploy`, restarts and checks health.
4. Then deploy the frontend (Vercel).
5. Smoke test: log in, open User Master, sign out.
