# Sawant Group Enterprise ERP

Production-ready ERP system for **Sawant Group (Ready Hand)** with multi-unit industrial operations:
* **Unit 1**: Talwade
* **Unit 2**: Sawardari
* **Unit 3**: Varale

Built with: **React (Frontend)** + **Node/Express + Prisma + PostgreSQL (Backend)**.
Reference prototype: `index.html` (kept at root as executable design standard).

* Git Repository: [https://github.com/developerrhai/first-erp.git](https://github.com/developerrhai/first-erp.git)
* Full architecture & plan: [`PLAN.md`](PLAN.md)
* Phase specifications: [`docs/`](docs/)

## Layout

| Folder / File | What it is |
|---|---|
| `apps/api` | Express + TypeScript + Prisma API (auth, sessions, RBAC, users, audit, module controls) |
| `apps/web` | React + Vite frontend: split-screen login, Sawant Group branding, unit selectors, app shell, modules |
| `index.html` | Original interactive prototype and visual source of truth |
| `packages/registry` | Page registry definitions across all 22 families and 248 enterprise modules |
| `deploy_to_ec2.ps1` | Automated deployment script to AWS EC2 instance (`13.204.199.132` on isolated port 5010) |
| `dump/` | Archive folder for non-production scratch artifacts (excluded from git) |

## Prerequisites

* Node 20+
* PostgreSQL running on `localhost:5432` (user `postgres` / password `postgres` in dev)
* The databases `rhai_erp` (dev), `rhai_erp_test` (API tests) and `rhai_erp_e2e` (e2e tests). All three already exist on this machine.

## First run

```bash
npm run install:all                 # installs root, registry, api, web
cd apps/api && cp .env.example .env # then edit secrets (JWT_ACCESS_SECRET, SUPERADMIN_*)
npm run db:migrate && npm run db:seed && cd ../..
npm run dev                         # API on :4000, web on :5173 (http://localhost:5173)
```

On first sign-in the Super Admin (the owner) must set a new password.

* Only the Super Admin can create **Admins**.
* Admins create **Managers, Leads and Members**.
* There is no sign-up.

## Checks

```bash
npm run verify   # lint + typecheck + unit/API tests of registry, api and web
npm run e2e      # full browser tests on ports 4100/5180 with a freshly reset rhai_erp_e2e database
```
