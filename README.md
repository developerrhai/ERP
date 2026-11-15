# Sawant Group Enterprise ERP

> **IMPORTANT**: Read [docs/phases/ROADMAP.md](docs/phases/ROADMAP.md) first before undertaking any development.
> The single source of truth for all requirements, architecture, and standards is located in [docs/phases/](docs/phases/).
> Historic plans in `docs/archive/` are kept for reference only.

Production-grade web ERP for **Sawant Group (Ready Hand)** with multi-unit industrial operations:
* **Unit 1**: Talwade (`TAL`)
* **Unit 2**: Sawardari (`SAW`)
* **Unit 3**: Varale (`VAR`)

Built with: **React 18 + TypeScript (Frontend)** + **Node 20 / Express + Prisma + PostgreSQL 16 (Backend)**.
Reference prototype: `index.html` (kept at root as frozen visual design standard).

## Project Structure

| Folder / File | Description |
|---|---|
| `docs/phases/` | **Source of truth**: Standards, Roadmap, Phase contracts, Status |
| `docs/archive/` | Historic plans, legacy phase contracts, and deployment reviews (reference only) |
| `apps/api` | Express + TypeScript + Prisma API backend |
| `apps/web` | React + Vite frontend application shell and modules |
| `packages/registry` | Page registry definitions across all 22 families and 248 enterprise modules |
| `packages/calc` | Pure calculation engine for statutory, tax, payroll, and valuation formulas |
| `index.html` | Visual reference prototype and frozen UI source of truth |

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
