# PHASE 00 — Foundation reset & standards
Goal: one source of truth, safe repository, repeatable checks, honest baseline.
NO feature code and NO database changes in this phase.

## 1. Why this phase exists
The review found: plans that contradict each other (PLAN.md vs DECISIONS.md vs code), secrets
near the repo, a build order that skipped approvals and finance, and no single status page.
Every later phase depends on this being clean.

## 2. Tasks
### T0-1 Docs restructure
- Create docs/phases/ and put ROADMAP.md, STANDARDS.md, PHASE-00.md there (owner provides text).
- Move PLAN.md, docs/plan/, docs/plans/, docs/phase1/, docs/phase2/, docs/phase3-4/,
  docs/DEPLOYMENT-REVIEW.md into docs/archive/ (git mv, keep history). Add docs/archive/README.md:
  "Archive. Reference only. docs/phases/ wins on any conflict."
- Keep docs/REGISTRY.csv and reference/screens/ where they are (still used).
- Update root README.md: short project intro, how to run, and "Read docs/phases/ROADMAP.md first".
- Update CLAUDE.md: add "Source of truth = docs/phases/. Build only the phase named by the owner."

### T0-2 Secret hygiene
- .gitignore must contain: .env, .env.*, !.env.example, **/.env, apps/**/.env*, !**/.env.example,
  deploy_to_ec2.ps1, deploy_to_ec2.local.ps1, *.pem, *.key, doc from clint/, dump/,
  node_modules/, dist/, .artifacts/, .parity/, coverage/, *.log.
- Check with `git ls-files` that none of those paths is tracked. If one is, list it in the
  report (do NOT rewrite history; the owner decides).
- apps/api/.env.example and apps/web/.env.example: every variable with a placeholder and a
  one-line comment. No real values.
- Add npm script `secrets:scan` using gitleaks (devDependency or npx) over the working tree,
  excluding node_modules. Add it to `npm run verify`.
- Report (do not change) whether any git remote URL contains a token: print only
  "token present: yes/no" — never the URL.

### T0-3 Tooling baseline
- .nvmrc = 20; "engines": { "node": ">=20 <21" } in every package.json.
- Root scripts (keep existing ones): verify, e2e, db:reset:test, typecheck, lint, test,
  secrets:scan. `verify` = secrets:scan + lint + typecheck + unit + API tests for registry, api, web.
- Add packages/calc/ skeleton (package.json, tsconfig, vitest config, src/index.ts exporting
  nothing yet, one placeholder test that asserts true) and include it in verify.
- Add Decimal helper rule to ESLint if possible: forbid parseFloat/Number() on fields named
  amount|qty|rate|value in apps/api/src/modules (warning level is fine).

### T0-4 Status page
Create docs/phases/STATUS.md with:
- A table of all 248 registry pages: page id, family, kind today (generic/typed/custom/not served),
  target phase (from ROADMAP §2). Generate it with a small script `npm run status:pages`
  (reads packages/registry + apps/api/src/engine/kinds.ts) so it can be regenerated each phase.
- A table of all existing migrations with the phase they belong to.
- A list of the known code issues from the review, each tagged with the phase that fixes it:
  C1 approvals missing → P5; C2 fixed roles → P2; C3 one department → P2;
  C4 single-item vouchers → P8; C5 backdate guard → P8; C6 generic delete/restore ignores
  status/token → P4; C7 kit commands cache/transaction → P4; C8 in-memory limits → P20 (single
  process until then); C9 placeholder screens → their module phases; D6 proxy IP headers → P1.

### T0-5 Baseline run
Run `npm run verify` and `npm run e2e` 3 times from a clean test DB. Record pass/fail counts and
the names of failing tests in PHASE-00-REPORT.md. Do NOT fix failures in this phase; list them
with the phase that should own each fix.

## 3. Out of scope
Any change to apps/api/src, apps/web/src, prisma schema or migrations (except adding
packages/calc and scripts). No deploy.

## 4. Acceptance checks
- [ ] docs/phases/ has ROADMAP, STANDARDS, PHASE-00, STATUS, PHASE-00-REPORT.
- [ ] Old plans are in docs/archive/ with the archive README.
- [ ] `git ls-files` shows no .env (except .env.exam
      nothing under doc from clint/ or dump/.
- [ ] `npm run secrets:scan` passes.
- [ ] `npm run verify` runs all packages including packages/calc.
- [ ] `npm run status:pages` regenerates STATUS.md and shows 248 pages.
- [ ] Baseline results recorded honestly (failures listed, not hidden).

## 5. Owner's manual check (5 minutes)
1. Open docs/phases/STATUS.md: does it list 248 pages with a target phase each?
2. Open .gitignore: are .env and the deploy scripts there?
3. Read PHASE-00-REPORT.md: how many tests pass today?

## 6. Prompt to paste into the build chat
"Read CLAUDE.md, docs/phases/STANDARDS.md, docs/phases/ROADMAP.md and docs/phases/PHASE-00.md.
Build Phase 00 exactly. No feature code, no DB changes. Stop and ask if anything is unclear.
Finish with docs/phases/PHASE-00-REPORT.md.”

