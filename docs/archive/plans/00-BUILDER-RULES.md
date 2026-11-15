# 00 — Builder Rules (READ THIS FIRST, EVERY SESSION)

**Who reads this:** the builder model (Haiku). **Who wrote the plans:** the architect. **Who checks your code:** the reviewer (the architect). You write code from the plans. You do not design. When the plan is unclear, you ask. You never guess.

---

> **Binding rulings that override any plan text are in `DECISIONS.md` — read it right after this file.** (No `company_id` on new tables; migrations are hand-written; one shared engine kit.)

## 1. The three roles and the loop

| Role | Does | Never does |
|---|---|---|
| **Architect** (plans) | Writes the plan files in `docs/plans/`, the DB design and the tickets | Writes the module code |
| **Builder** (you) | Implements **one ticket at a time**, exactly as written, with tests | Changes the design, the UI, the DB names or the order of the tickets |
| **Reviewer** (architect) | Reads your diff and your report, finds mistakes, returns a numbered fix list | Accepts a ticket without green tests |

**The loop for every ticket:** read the ticket → read the files the ticket names → write the code → write the tests → run the checks → write the **Builder Report** (section 8) → stop. The reviewer answers "ACCEPTED" or "FIX LIST". You fix only what is on the list, then report again.

---

## 2. THE UI IS FROZEN (the most important rule)

The user's prototype `index.html` (copy in `reference/index.html`) is the UI. The finished app must **look and behave exactly like it**.

**Frozen, never change:**
1. The 22 families, the 248 menu pages, their **ids, titles, order and icons**. They come from `packages/registry/registry.json`. Do not edit that file by hand.
2. For every page: the 6 profile **tab names** and the **field names, order and meaning** from the registry. A field's label is its identity.
3. The universal 16-tab strip order, the page head (title, purpose, Excel / Print / ＋ Add), the context chips, the table look, the modal, the drawer, the toast, the login screen, the sidebar, the top bar.
4. CSS class names and values (`apps/web/src/styles/*.css`, copied from the prototype). Do **not** add a CSS framework. Do not restyle.
5. Wording of existing buttons and headings.

**Allowed (and only if the ticket says so):**
* New fields or tabs marked `[ADD]` in the plan. They are always **added after** the frozen ones, never in between, never replacing.
* New buttons marked `[ADD]`.
* New sub-views inside an existing tab.

**Forbidden:** renaming a page, merging two pages, deleting a field "because it is not needed", moving a field, new colours, new fonts, new layouts, emoji changes. If you think the UI is wrong, write `QUESTION:` in your report. Do not fix it.

**How the reviewer checks the freeze:** the registry test (`packages/registry`), the schema tests (`apps/api/tests/fixtures/field-types.json` lists every field of every page), and Playwright screenshot comparison with `reference/screens/v92/`.

---

## 3. Hard safety rules

1. **Never** `git push`, `git commit`, `git tag`, deploy, run `vercel`, `pm2`, `ssh`, `scp`, or any `deploy_to_ec2*.ps1`. You only change files on disk. The owner commits.
2. **Never** print or copy secrets: `.env` values, passwords, tokens, keys, the git remote URL (it contains a token).
3. **Databases:** only local `rhai_erp` (dev), `rhai_erp_test`, `rhai_erp_e2e`. Never the old database `erp`. Never a remote database. Never reset `rhai_erp` (dev) — only `rhai_erp_test` is reset freely.
4. **Memory is tight on this machine:** run **one** vitest / Playwright / Vite process at a time. Never run two test commands at once.
5. Do not install a new npm package unless the ticket names it. Pin exact versions if you do.
6. Do not edit files outside the ticket's file list, except to add imports/registrations the ticket names.
7. Never weaken a test to make it pass. Never delete a test. Never use `any`, `@ts-ignore`, `eslint-disable` (unless the existing code already does the same in the same place).

---

## 4. Code rules (the project's standards)

* **TypeScript strict**, no `any`, no `!` (non-null) outside tests, no default exports, no `console.log` (use the `logger`).
* **Every new source file starts with a 1–3 line comment: why this file exists.**
* Names: files `kebab-case.ts`, components `PascalCase.tsx`, DB tables `snake_case` plural, Prisma models `PascalCase` singular with `@@map`, API paths `kebab-case` plural, page ids exactly as in the registry.
* **Layers (API):** `routes → controller → service → repository → Prisma`.
  * routes: path + middleware only (`authenticate`, `resolveContext`, `requirePageAction`, `validate`).
  * controller: HTTP only, no business logic.
  * service: business rules, transactions, state machines, audit.
  * repository: the **only** place that touches Prisma/SQL.
  * A module never reads another module's repository. It calls that module's **service**.
* **Money** is `numeric(18,2)` (Prisma `Decimal`), quantities `numeric(18,3)`, rates `numeric(18,6)`. **Never use JavaScript `number` for money arithmetic** — use `Decimal` (see `apps/api/src/modules/inventory/money.ts`). Round half-up at the stated places only.
* **Every write** is audited (`AuditService`), uses optimistic locking (`version` + `If-Match`), and runs in **one DB transaction**.
* **Every list** is server-paginated, filtered by **unit + FY context** and **data scope** (OWN / DEPARTMENT / ALL).
* **Posted/approved documents are never edited or deleted.** They are cancelled by a **reversal document**.
* **Gap-free numbering** comes only from `number_series` with `SELECT … FOR UPDATE` (see `apps/api/src/modules/records/repository.ts`). Never `MAX(code)+1`.
* **Append-only tables** (ledgers, audit) get a DB trigger that blocks UPDATE/DELETE/TRUNCATE (copy the migration in `20261105000000_phase5_inventory`).
* **Idempotency:** every action that changes stock/money accepts `Idempotency-Key` (existing helper).
* **Error format** is fixed: `{error:{code,message,status,requestId,fields?}}`. Use `Errors.*` helpers; add a new code only if the ticket says so.
* **Permissions:** every route uses `requirePageAction(pageId, action)`. Administration pages are ADMIN+ only. Never check roles by name in a service; use `can()`.

---

## 5. Where the working examples are (copy these patterns, do not invent)

| You need | Open this canonical example |
|---|---|
| A typed page (own tables, actions, filters, totals, views) | `apps/api/src/modules/inventory/definitions.ts`, `typed-pages.ts`, `typed.ts` |
| Voucher with post/cancel/reverse | `apps/api/src/modules/inventory/vouchers/service.ts` |
| A posting engine under row lock | `apps/api/src/modules/inventory/stock/posting.ts` |
| Master with soft delete + undo | `apps/api/src/modules/inventory/items/service.ts` |
| Generic page engine (fields → schema → CRUD) | `apps/api/src/engine/*`, `apps/api/src/modules/records/*` |
| Permission decision | `apps/api/src/core/rbac/access.ts` |
| Context (unit + FY) | `apps/api/src/core/context/resolve-context.ts` |
| Audit | `apps/api/src/core/audit/audit-service.ts` |
| Migration with CHECK + trigger + seed | `apps/api/prisma/migrations/20261105000000_phase5_inventory/migration.sql` |
| Seed (idempotent, insert-if-missing) | `apps/api/src/core/seed/phase5-defaults.ts`, `run-seed.ts` |
| API test with supertest | `apps/api/tests/phase5-stock.test.ts`, helpers in `phase5-helpers.ts` |
| Simulation / invariant test | `apps/api/tests/phase5-simulation.test.ts` |
| Web: generic/typed page | `apps/web/src/pages/generic/GenericModulePage.tsx` and neighbours |
| Web: admin page with form + errors | `apps/web/src/pages/admin/DepartmentMasterPage.tsx` |
| e2e flow | `tests/e2e/phase5.spec.ts` |

Before writing anything, **open the canonical example, read it fully, and copy its structure**. A new typed page = a new entry in `definitions.ts` + a handler in `typed-pages.ts` + a service/repository folder + a migration + tests. Do not create a second way of doing the same thing.

---

## 6. Commands (run from the folder shown; run one at a time)

| What | Command |
|---|---|
| API: reset test DB | `cd apps/api && npm run db:reset:test` |
| API: lint + typecheck + all tests | `cd apps/api && npm run verify` |
| API: one test file | `cd apps/api && npx vitest run tests/<file>.test.ts` |
| API: build | `cd apps/api && npm run build` |
| API: apply migrations to dev | `cd apps/api && npm run db:migrate && npm run db:seed` |
| New migration | **Write it by hand** (never `prisma migrate dev`, it can reset/diff the database): create the folder `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` with the DDL from the plan, add the scalar Prisma models to `schema.prisma`, run `npx prisma generate`, then `npm run db:reset:test` applies it to the test DB, and `npm run db:migrate` to the dev DB. Never edit an already-applied migration. |
| Web: checks | `cd apps/web && npm run verify` |
| Web: build | `cd apps/web && npm run build` |
| E2E (whole system) | `npm run e2e` (from the repo root) |

**Definition of done for a ticket:** `npm run verify` green in every package you touched, **plus** the ticket's own tests, **plus** the build. Paste the final summary lines in your report. Never write "should pass" — only what you ran.

---

## 7. Lessons from this project (do not repeat these mistakes)

1. **Test isolation:** a test's `afterAll` must delete **only the rows it created**. Deleting a whole table (e.g. `number_series`) made other test files fail at random.
2. **Ordering:** a DB returns rows in no fixed order. Always `ORDER BY`. Sort arrays you put into audit entries or compare in tests.
3. **Parallel requests in tests:** one session cookie rotates on every refresh. Fetch one token, then run parallel requests with it.
4. **Field typing:** `Priority`, `Severity`, `Stage`, `Type`, `Mode`, `Channel`, `Category`, `Method` are drop-downs. Anything called `... Name`, `Description`, `Remarks`, `Address` is text. The truth is `apps/api/tests/fixtures/field-types.json`.
5. **Required dates:** only a real document date is required (Order Date, Invoice Date). Follow-up, expected, due, planned, promised, actual and other outcome dates are optional.
6. **Money in JS:** `0.1 + 0.2 !== 0.3`. Use `Decimal`.
7. **Double click / retry:** the action must be safe to send twice (Idempotency-Key, status check inside the transaction).
8. **Locks:** take the row lock **inside** the transaction, **before** reading the value you will change.
9. **Soft delete:** a deleted record keeps its code. A code is never reused.
10. **Unit scope:** a write needs a concrete unit (`requireConcreteUnit`). "All Units" is read-only and ADMIN+ only.
11. The status field named exactly `Status` is the workflow status. Other `... Status` fields are normal editable drop-downs.
12. A page that has a real implementation is in `TYPED_PAGES` (`apps/api/src/engine/kinds.ts`); the generic engine must then answer 404 `NOT_GENERIC` for it.

---

## 8. The Builder Report (the last thing you write for every ticket)

```
TICKET: <id>
STATUS: DONE | BLOCKED | QUESTION
FILES CREATED: <path> — <one-line why>
FILES CHANGED: <path> — <one-line why>
MIGRATIONS: <name> | none
COMMANDS RUN AND RESULT (paste the summary line of each):
  - <command> → <result>
TESTS ADDED: <file> — <count> tests — <what they prove>
RULES FROM THE PLAN IMPLEMENTED: BR-xx, BR-yy …
RULES NOT IMPLEMENTED (and why): …
DEVIATIONS FROM THE TICKET: none | <what and why>
QUESTION: <only if something in the plan is unclear or contradicts the code>
```

Rules for the report: list only what you actually did. If a command was not run, write "NOT RUN". If a test fails, write the failure; do not hide it.

---

## 9. When to stop and ask

Write `STATUS: QUESTION` and stop when:
* the plan and the existing code disagree;
* a field, table or endpoint the ticket mentions does not exist;
* you would have to change a frozen thing (section 2);
* a test needs a business rule that the plan does not state.

Never fill a gap with your own idea.

---

## 10. Plan file map

| File | Module |
|---|---|
| `01-SHARED-FOUNDATION.md` | Shared tables (parties, tax codes, UOM, document links), service interfaces, ownership and order |
| `02-INVENTORY-WMS.md` | Inventory (14 pages) and Warehouse / WMS (13 pages) |
| `03-SCM-PROCUREMENT.md` | Procurement / SCM (11 pages) |
| `04-SALES-CRM.md` | CRM (8) and Sales (10) |
| `05-FINANCE-TAX.md` | Finance & Accounts (19) and Indian Taxation (10) |
| `06-QUALITY-QMS.md` | Quality / QMS (10 pages) from the client's sheets |
| (later) | Manufacturing, Maintenance, Assets, HRMS, Payroll, Projects, Service, Logistics, DMS, BI, AI, Communication |

Order of work: **Inventory → Procurement → Sales → Finance & Tax** (finance posts what the others produce; until it exists, modules write to the `accounting_event_queue` stub, see 01 section 5). Tickets in each plan name their dependencies.
