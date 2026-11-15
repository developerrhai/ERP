# 05d — Finance & Tax: build tickets (section 12)

> Part 4 of 5 of `05-FINANCE-TAX.md`. Read `00-BUILDER-RULES.md`, `01-SHARED-FOUNDATION.md`, `05a`, `05b`, `05c` first. One ticket = one builder session (<= ~12 files, <= ~900 lines). Strict order: a ticket may use only what earlier tickets built. **Preconditions for the whole plan** (each first migration starts with a guard `DO $$ ... RAISE EXCEPTION` listing missing tables): `users, units, financial_years, number_series, settings, audit_logs` (exist) and, from plans 02-04 (built before this plan; if one is missing the builder stops): `accounting_event_queue` (02), `parties`, `tax_codes`, `hsn_sac`, `tds_sections` (03). A missing assumed table -> `STATUS: QUESTION` (never create it).

Conventions for all tickets: module root `apps/api/src/modules/finance/` (`F/`) and `apps/api/src/modules/tax/` (`X/`); tests in `apps/api/tests/fin-*.test.ts` using `phase5-helpers.ts` patterns; every new file starts with the 1-3 line "why" comment; money only through `F/money.ts` (`D, r2, str`, copied API of `inventory/money.ts`); every write audited (`recordAudit`); every posting inside one transaction; `Idempotency-Key` on money POSTs; test cleanup deletes only rows the test created (ledger tables are append-only: tests create their own company data inside a dedicated unit/FY and never truncate).

---

### T-FIN-01 Migration M1: accounts, periods, report lines, defaults, cost and profit centres (M)
**Depends:** none (preconditions). **Rules:** BR-FIN-42.
**Files:** `apps/api/prisma/migrations/20261110000000_fin01_coa_periods/migration.sql`; `apps/api/prisma/schema.prisma` (models `Account, FiscalPeriod, ReportLine, AccountDefault, CostCenter, ProfitCenter` exactly 5.2-5.5); `apps/api/tests/fin-schema-m1.test.ts`.
**Steps:** 1) `npx prisma migrate dev --create-only --name fin01_coa_periods`. 2) Replace the SQL with: the precondition guard; the DDL of 5.2, 5.3, 5.4, 5.5 verbatim (STD/SOFT expanded). 3) Add the Prisma models (scalar FKs, `@@map`, `@@unique`, per 5.0 rules); `prisma generate`. 4) Test with raw SQL on `rhai_erp_test`: insert an account with `root_type='Asset'` and `normal_balance='Credit'` -> CHECK fails; group with `posting_allowed=true` fails; duplicate `(code)` fails; `fiscal_periods` `period_no=13` fails; second default profit centre for one unit fails.
**Accept:** `npm run db:reset:test` applies; `prisma generate` ok; test green; `npm run verify` green.
**Do NOT:** seed data here; edit applied migrations; add Postgres ENUMs.

### T-FIN-02 Seeds: chart of accounts, report lines, defaults, centres, periods, settings (M)
**Depends:** T-FIN-01. **Rules:** BR-FIN-42, section 5.15-5.18.
**Files:** `apps/api/src/core/seed/phase8-finance-defaults.ts`; `apps/api/src/core/seed/run-seed.ts` (register category `finance`); `F/periods/ensure-periods.ts`; `apps/api/tests/fin-seed.test.ts`.
**Steps:** 1) `seedChartOfAccounts(db, userId)`: data array of the 211 rows of 5.15 (code, name, parentCode, rootType, subType, flags, cf, rl); insert missing codes ordered by code length then code (parents first), compute `normal_balance` from root type, `is_system=true`; idempotent (never updates existing rows). 2) `seedReportLines` (5.16 PNL, BS, CF), `seedAccountDefaults` (5.17 keys -> account by code; fail if a code is missing), `seedCostProfitCenters` (5.18; profit centre per unit `PC-TAL/SAW/VAR`, `is_default`), `seedExpensePolicies`, `seedSettings` (keys of 5.18, insert-if-missing). 3) `ensureFiscalPeriods(db, userId)`: for each `financial_years` row without 12 periods insert months from `start_date` (April = 1), name `Apr 2026`, status `CLOSED` if the FY is CLOSED else `OPEN`; export for reuse by the job (7.12) and by the `admin-fy` create hook (call it after FY creation if that service exists: add the call, nothing else). 4) Register in `runSeed` report counts. 5) Tests: seed twice -> counts equal; 211 rows, 27 groups; every `report_line_code` of postable accounts exists in `report_lines`; every default key resolves; unit count 3 profit centres; 12 periods per FY, period 1 starts 1 April; `3009` exists.
**Accept:** seed test green; `run-seed` idempotent.
**Do NOT:** hard-code UUIDs; seed GST/TDS here.

### T-FIN-03 Migration M2: ledger, triggers, open items, allocations, posting_rules (L)
**Depends:** T-FIN-02. **Rules:** BR-FIN-01, 04, 05.
**Files:** `.../20261110000100_fin02_ledger/migration.sql`; `schema.prisma` (models `Journal, JournalLine, GlEntry, PostingRule, OpenItem, Allocation`); `apps/api/tests/fin-ledger-db.test.ts`.
**Steps:** 1) SQL = DDL of 5.6 (journals, journal_lines, gl_entries, the four trigger functions, the guarded `DO` block for `parties` FKs), 5.7 (`posting_rules` only; the queue ALTER is T-FIN-05), 5.8 (open_items, allocations, triggers). Create function `fin_gl_append_only` **before** it is used by `allocations` triggers. 2) Prisma models per 5.6-5.8 (use the `autoincrement()` fallback for `seq` if `dbgenerated()` is refused). 3) DB tests (raw SQL, inside a transaction each): inserting unbalanced `gl_entries` and committing -> error containing `JOURNAL_UNBALANCED`; a one-row journal fails; balanced 2-row journal commits; `UPDATE`/`DELETE`/`TRUNCATE gl_entries` blocked; lines of a Posted journal cannot be inserted/updated/deleted; Posted journal `UPDATE narration` blocked but `status -> Cancelled` allowed; hard delete of a Posted journal blocked; `allocations` append-only; a line with both debit and credit fails; `open_items.outstanding` is generated (`amount 100, settled 30` -> 70; `amount -100, settled 30` -> -70); `settled_amount > abs(amount)` fails.
**Accept:** tests green; `npm run verify` green.
**Do NOT:** add UPDATE/DELETE paths for `gl_entries`; relax a trigger "for tests".

### T-FIN-04 AccountingService core: money, periods, validation, `postJournal`, `reverse` (L)
**Depends:** T-FIN-03. **Rules:** BR-FIN-01 to 08, 11 (cash controls only the helper), 37.
**Files:** `F/money.ts`; `F/accounting/types.ts`; `F/accounting/validate.ts`; `F/accounting/periods.ts`; `F/accounting/repository.ts`; `F/accounting/service.ts`; `F/accounting/numbering.ts`; `apps/api/src/core/http/errors.ts` (add the `ErrorCode` members and `Errors.*` helpers of 7.7 used by this ticket: `JOURNAL_UNBALANCED, AMOUNT_PRECISION, PERIOD_LOCKED, NO_PERIOD, FUTURE_DATE, BEFORE_GO_LIVE, ACCOUNT_NOT_POSTABLE, COST_CENTER_REQUIRED, PARTY_REQUIRED, PARTY_ROLE_MISMATCH, PARTY_NOT_ALLOWED, ALREADY_REVERSED, CANNOT_REVERSE_REVERSAL, REVERSAL_DATE_INVALID, REASON_REQUIRED, SETTLED_DOCUMENT, RECONCILED_ENTRY`); `apps/api/src/core/audit/audit-service.ts` (add actions `JOURNAL_POSTED, JOURNAL_REVERSED` and target type `Journal` if missing); `apps/api/tests/fin-accounting.test.ts`.
**Steps:** implement `postJournal` exactly as 7.1.1 (13 steps, in that order) with these functions: `assertBalanced(lines)`; `resolvePeriod(tx, date)` (`SELECT ... FOR SHARE`); `loadAccounts(tx, ids)`; `validateLine(account, party, line)`; `nextVoucherNumber(tx, voucherType, unitId, fyId)` using `NumberingService`/`recordRepository.nextNumber` with docType per BR-FIN-06b; `insertJournal/insertLines/insertGlEntries/finalisePosted` in the repository (raw SQL for the status update); `reverse(tx, journalId, reason, actor, opts)` per BR-FIN-04: lock the journal row `FOR UPDATE`, build swapped lines, call `postJournal` with `voucherType='Reversal'` and `reversal_of_id`, update the original (`status='Cancelled'`, `posting_status='Reversed'`, `reversed_by_id`), set `gl_entries.is_reversal` / `reverses_gl_id` for the new rows. Sub-ledger and tax steps (11, 12) and budget (6) call **no-op hooks** `hooks.afterPost(tx, journal, input)` / `hooks.beforePost` registered later (`F/accounting/hooks.ts`); `post()` (QUEUE vs INLINE mode) is T-FIN-05. Add `AccountingService` export from `F/accounting/index.ts` and make the Inventory stub delegate to it **only** in T-FIN-05.
**Tests (numbers):** (1) balanced 3-line journal (Dr 5,000.00; Cr 2,000.00; Cr 3,000.00) posts; `gl_entries` 3 rows; `total_debit = total_credit = 5000.00`. (2) Cr 4,999.99 -> 422 `JOURNAL_UNBALANCED`, nothing written. (3) amount `10.005` -> `AMOUNT_PRECISION`. (4) group account -> `ACCOUNT_NOT_POSTABLE`; inactive account likewise. (5) account with `cost_center_required` and no cost centre -> `COST_CENTER_REQUIRED`. (6) control account 1201 without party -> `PARTY_REQUIRED`; with a supplier-only party -> `PARTY_ROLE_MISMATCH`. (7) date in a `LOCKED` period -> `PERIOD_LOCKED`; in `CLOSED` -> `PERIOD_CLOSED`; FY CLOSED -> `PERIOD_CLOSED`; date outside every period -> `NO_PERIOD`. (8) reverse: swapped lines, original `Cancelled`, second reverse -> `ALREADY_REVERSED`, reversing the reversal -> `CANNOT_REVERSE_REVERSAL`; net balance of every account 0.00. (9) two parallel `postJournal` calls with the same source key -> one journal (idempotent). (10) numbering gap-free: failing post (unbalanced) does not consume a number (next post gets the next number). (11) number format `JV/TAL/2026-27/0001`.
**Accept:** all above green; no `number` type used for money (grep test in the file: no `parseFloat`/`Number(` on money in `F/accounting/**` except in `toDto`).
**Do NOT:** write `gl_entries` anywhere else; accept `any`; catch and swallow DB `JOURNAL_UNBALANCED`.

### T-FIN-05 Queue columns, `AccountingService.post`, payload schemas, adapters (M)
**Depends:** T-FIN-04. **Rules:** BR-FIN-05, 4.1.4 (alignment).
**Files:** `.../20261110000150_fin02b_queue/migration.sql` (the ALTERs of 5.7 + guard that `accounting_event_queue` exists with `status, journal_id, error, processed_at, payload`); `schema.prisma` (add `unitId, attempts, lastErrorAt` to the queue model); `F/events/schemas.ts` (zod for the event envelope and the `tax`, `tds` blocks, 4.1.3 / 4.1.4); `F/events/adapters.ts`; `F/accounting/enqueue.ts`; `F/accounting/service.ts` (`post`); the plan-02 stub file (replace its body to delegate to `F/accounting/service.post`; keep its exported signature; accept `lines` or `payload`); `apps/api/tests/fin-enqueue.test.ts`.
**Steps:** `post(tx, input, actor)`: read setting `fin.posting_mode`; `QUEUE` -> `INSERT ... ON CONFLICT (event,doc_type,doc_id) DO NOTHING RETURNING id`; if conflict, load the existing row and compare `sha256(canonical payload JSON)` stored in `payload.__hash` -> different -> 409 `EVENT_PAYLOAD_CHANGED`; return `{queued:true, queueId}`. `INLINE` -> call `postJournal`. Validate the envelope with zod: `unitId` uuid, `date` ISO, `lines[]` with `account` key (`^[A-Z_]{2,40}$`), money strings 2 dp, `debit XOR credit`; Σ debit = Σ credit (else 422 `JOURNAL_UNBALANCED` **at enqueue time** so the producer's transaction fails early). One adapter function per known event name in `adapters.ts` mapping producer payloads to the internal `NormalisedEvent` (`partyId, docNo, dueDate, tax?, tds?, rcm?, allocations?, reverses?`).
**Tests:** enqueue twice same key -> one row; changed payload -> 409; unbalanced lines -> 422 and no row; INLINE mode posts; stub callers (existing Inventory code paths if any) still pass.
**Accept:** green. **Do NOT:** drain here; change the producers' code.

### T-FIN-06 Posting rules engine and seeds (MAP and BUILD) (L)
**Depends:** T-FIN-05. **Rules:** 4.1.4 item 4, 5.20.
**Files:** `F/events/rules-engine.ts` (`resolveLines`); `F/events/conditions.ts`; `F/events/rules-repository.ts`; `F/events/rules-seed.ts`; `F/events/sample-payloads.ts`; `apps/api/src/core/seed/phase8-finance-defaults.ts` (add `seedPostingRules`); `apps/api/tests/fin-rules.test.ts`.
**Steps:** 1) `resolveLines(tx, event, normalised, date)`: **MAP mode** (event has `lines`): for each line find the first active rule with `rule_kind='MAP'`, `line_key = line.account`, `event IN (event,'*')`, effective on `date`, ordered by `event <> '*'` first then `seq`; evaluate `condition` (jsonb `{path, op, value}` or `{all:[...]}`/`{any:[...]}`; ops `eq, ne, gt, gte, lt, lte, in, truthy, falsy`; path prefixes `payload.` / `line.`; comparison numeric via Decimal when both parse); selector `FIXED_CODE` (account by code), `DEFAULT_KEY` (`account_defaults.key`), `PAYLOAD_BANK_ACCOUNT` (`bank_accounts.account_id` of `payload.bankAccountId`); no rule -> 422 `UNMAPPED_ACCOUNT_KEY`. Output `JournalLineInput[]` carrying party (control keys `AR`, `AP_CONTROL` get `billMode:'NEW'` for credit-side-of-nature documents, `'AGAINST'` never from rules), cost centre (`line.costCenter` code -> id), `unitId` of the payload. **BUILD mode** (no lines): rules of kind `BUILD` per 5.20 semantics (`amount_path` dotted path into the payload, `amount_fn` RAW/POS/NEG/ABS on Decimal, `foreach_path` array iteration, conditions as above, skip zero amounts). 2) `seedPostingRules`: MAP rows of 4.1.4 item 4 (seq 10 per key, overrides seq 5, 4, ...), BUILD rows of 5.20 for the Finance events (`EXPENSE_CLAIM_APPROVED`, `FIN_CREDIT_NOTE_POSTED`, `FIN_DEBIT_NOTE_POSTED`, `DEPRECIATION_POSTED`, `STOCK_*` fallbacks). 3) `PUT /finance/posting-rules` service function `replaceRules(event, rules)` validates by running `resolveLines` on `sample-payloads.ts[event]` and asserting balance (`RULE_UNBALANCED`).
**Tests (use numbers of BR-SCM-23 and BR-SAL-43):** GRN lines (Dr INVENTORY 10,600.00; Cr GRIR 10,000.00; Cr LANDED_COST_CLEARING 600.00) -> accounts 1301 / 2150 / 2151, balanced; item type `Finished Good` -> 1303; PURCHASE_INVOICE (Dr GRIR 10,000; Dr INPUT_CGST 900; Dr INPUT_SGST 900; Cr TDS_PAYABLE 200; Cr AP_CONTROL 11,600) -> 2150, 1401, 1402, 2311, 2101; import -> 2102; SALES_INVOICE (Dr AR 14,603.00; Cr SALES 12,375.00; Cr OUTPUT_CGST 1,113.75; Cr OUTPUT_SGST 1,113.75; Cr ROUND_OFF 0.50) -> 1201, 4101, 2301, 2302, 6270; export invoice -> 1202 / 4102; unknown key `FOO` -> `UNMAPPED_ACCOUNT_KEY`; BUILD sample for each Finance event balances (property loop over 200 random payloads: rounding-off positive/negative, with/without TDS and RCM; all balanced).
**Accept:** green. **Do NOT:** use `eval`/`Function`; allow arbitrary SQL in conditions.

### T-FIN-07 Queue drain, retries, reverse by source, side-records hooks (L)
**Depends:** T-FIN-06. **Rules:** BR-FIN-05, 4.2.
**Files:** `F/events/drain.ts`; `F/events/side-records.ts` (sub-ledger hook; tax and TDS hooks are stubs here, filled by T-FIN-15/27/31); `F/events/routes.ts`; `F/events/controller.ts`; `F/accounting/hooks.ts` (register hooks); `apps/api/src/app.ts` (mount `/finance/queue/*`); `apps/api/src/server.ts` (`startFinanceJobs`, 7.12); `apps/api/tests/fin-drain.test.ts`.
**Steps:** `drainQueue({limit})`: loop: in a fresh transaction `SELECT ... WHERE status='PENDING' AND doc_date <= current_date + 1 ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`; call `post` INLINE via the rules engine with `source='EVENT'`, `voucherType` from an event->type map (GRN_POSTED `Goods Receipt`, PURCHASE_INVOICE_POSTED `Purchase Invoice`, PURCHASE_RETURN_POSTED `Debit Note`, DELIVERY_POSTED `Delivery`, SALES_INVOICE_POSTED `Sales Invoice`, SALES_RETURN_POSTED / CREDIT_NOTE_POSTED `Credit Note`, RECEIPT_RECEIVED `Receipt`, STOCK_* `Stock Adjustment`), journal code `EV/<abbr>/<docNo>` (BR-FIN-06b); success -> `status='POSTED', journal_id, processed_at`; failure -> rollback, then a second transaction sets `FAILED`, `error = code + ': ' + message` (<= 500 chars), `attempts+1`, `last_error_at`. `*_CANCELLED` events -> `reverseBySource` using `payload.reverses`. Retry: job re-queues `FAILED` with `attempts < 5` older than 15 min; `POST /finance/queue/:id/retry` resets; `redate` (MANAGER, `delete` on fin-journal) changes `doc_date` of a FAILED row. Endpoints: `POST /finance/queue/drain`, `GET /finance/queue`, `retry`, `redate` (7.3).
**Tests:** 3 PENDING rows (GRN, invoice, sales invoice, from T-FIN-06 samples) -> 3 journals, rows POSTED; a row whose date is in a LOCKED period -> FAILED `PERIOD_LOCKED`, other rows unaffected; after unlock + retry -> POSTED; drain run twice concurrently (two promises) -> exactly one journal per row; `GRN_CANCELLED` reverses the GRN journal; replays of an already POSTED key do nothing.
**Accept:** green. **Do NOT:** process rows inside one big transaction; mark POSTED before the journal is committed.

### T-FIN-08 Finance typed-page infrastructure, permissions, read-only report pages (L)
**Depends:** T-FIN-07. **Rules:** BR-FIN-44, 7.2, 7.6, FC-4, FC-5.
**Files:** `apps/api/src/engine/kinds.ts` (add the 29 ids to `TYPED_PAGES`); `F/schema-helpers.ts`; `F/typed-extra.ts` (`FinanceSchema` = `TypedSchema` + `tabViews`, `reportColumns`); `F/typed-pages.ts` (pageId -> handler map, empty handlers answering `NOT_IMPLEMENTED` until later tickets); `F/report-handler.ts` (`makeReportHandler({pageId, list, exportRows})`: list/get/export only, others throw `Errors.readOnly()`); `apps/api/src/modules/inventory/typed-pages.ts` or the records controller dispatch (add `financeTypedHandlerFor` lookup next to `typedHandlerFor`, do not change inventory behaviour); `apps/api/src/core/http/errors.ts` (remaining error codes of 7.7); `apps/api/src/core/audit/audit-service.ts` (all audit actions/targets of 7.7); `apps/api/tests/fin-pages-infra.test.ts`.
**Steps:** 1) Add ids; the generic engine now answers 404 `NOT_GENERIC` for them. 2) `GET /pages/:id/schema` for each of the 29 returns `kind:'typed'`, `readOnly` per section 1, the registry label/order fields (generated from `packages/registry/registry.json`: a function `fieldsFromRegistry(pageId)` maps label -> key (camelCase), type from `field-types.json` semantic, required flag), `tabViews` (empty until the page tickets), `actions: []`. 3) Report pages: `POST/PATCH/DELETE/restore/bulk/actions` -> 405 `READ_ONLY`. 4) Context helper `F/context.ts`: `unitIdsFor(caller)` (concrete unit or permitted units), `fyOf(caller)`, `assertWritable(caller)` (`requireConcreteUnit`, FY OPEN). 5) Lookups `GET /lookups/accounts|cost-centers|profit-centers|bank-accounts|gst-registrations|parties` (controller stubs reading the tables; parties lookup calls plan 03's `PartyService` if it exports a search, else a direct read of `parties` by `is_customer/is_supplier`) with `view` on the owning page, `limit 1-50`.
**Tests:** every one of the 29 ids: schema kind typed; labels and order equal the registry; generic `GET /pages/<id>/records` still 404 `NOT_GENERIC` shape; report page POST -> 405; unauthenticated 401; a user without `view` -> 403.
**Accept:** green; the existing phase4/5 tests still pass. **Do NOT:** change the existing generic page list for other families.

### T-FIN-09 `fin-journal` page: draft CRUD, submit, approve, post, reverse (L)
**Depends:** T-FIN-08. **Rules:** BR-FIN-01 to 04, 39, 43; flow 4.3.
**Files:** `F/journals/definitions.ts`; `F/journals/repository.ts`; `F/journals/service.ts`; `F/journals/handler.ts`; `F/journals/routes.ts` (`GET /finance/journals/:id`); `F/typed-pages.ts` (register); `apps/api/tests/fin-journal.test.ts`.
**Steps:** schema per 2.1.3 (fields, statuses, actions of 7.2, filters, totals, views `lines|docs|approval|reversals`, `tabViews`); create Draft (code `DRAFT-<8hex>`, lines replaced as a set, totals computed server-side with Decimal, no balance requirement for Draft); `PATCH` needs `If-Match`; `submit` validates every line via `validateLine`, balance, period (without posting) and sets `posting_status` `Pending Approval` when `total_debit >= fin.journal_approval_threshold` else `Not Posted`; `approve` (`delete` on page, user <> `prepared_by` else 403 `MAKER_CHECKER`); `reject`; `post` (needs approval when pending; calls `postJournal` with the Draft's lines; the Draft row is **finalised in place** (same journal id: `postJournal` accepts `existingJournalId` to skip insert-journal and insert lines already present); `reverse` calls `AccountingService.reverse`; `delete` Draft soft delete (`deleted_at`); event-created journals are listed read-only (`source <> 'MANUAL'`: actions blocked 409 `RECORD_LOCKED`). Auto-reverse job function `autoReverseDue`.
**Tests:** create/patch/version conflict; submit unbalanced -> `JOURNAL_UNBALANCED`; 6,00,000.00 journal -> Pending, same user approve -> 403, other user approve -> ok, post -> number `JV/TAL/2026-27/0001`; post then PATCH -> 409 `RECORD_LOCKED`; reverse; delete Draft keeps no number; list filters; totals; OWN scope hides others' drafts; double click `post` with the same Idempotency-Key -> one journal.
**Accept:** green. **Do NOT:** allow editing of posted lines; assign the JV number before `post`.

### T-FIN-10 `fin-coa` page: accounts CRUD, tree, validation (L)
**Depends:** T-FIN-09. **Rules:** BR-FIN-42.
**Files:** `F/accounts/definitions.ts`, `repository.ts`, `service.ts`, `handler.ts`, `routes.ts` (`/finance/accounts/tree|lookup`, `/finance/coa/validation`); `apps/api/tests/fin-coa.test.ts`.
**Steps:** schema 2.1.1 (including `[ADD]` Sub Type, Report Line, Cash Flow Class); create (code user-entered `^[0-9]{4,8}$`; `normal_balance` derived; `parent` must be a group of the same root type; group -> `posting_allowed=false`), patch (immutability rules), actions `activate`/`deactivate` (blocked with balance `ACCOUNT_HAS_BALANCE`), soft delete (`IN_USE` when entries or children, system accounts `PROTECTED`); tree endpoint with balances from `fn_account_movement`-like query (the SQL functions arrive in T-FIN-18: use a plain `SUM` query now); COA validation rules: ledger without report line, BS ledger with `cf_class='NA'`, group with entries, duplicate names under a parent, missing default keys, `3009` non-zero, control accounts not flagged.
**Tests:** create 4-digit code; duplicate -> 409 `DUPLICATE`; parent type mismatch 422; change `root_type` after an entry -> 409; delete with entries -> `IN_USE`; deactivate with balance -> `ACCOUNT_HAS_BALANCE`; tree rolls groups up (Σ children); validation returns zero fails on the seeded COA.
**Accept:** green. **Do NOT:** allow deleting seeded `is_system` accounts.

### T-FIN-11 `fin-gl` General Ledger report page (M)
**Depends:** T-FIN-10. **Rules:** BR-FIN-44.
**Files:** `F/ledger/definitions.ts`, `repository.ts`, `service.ts`, `handler.ts`, `routes.ts` (`/finance/ledger`, `/finance/ledger/integrity`, `/finance/party-ledger`); `apps/api/tests/fin-gl.test.ts`.
**Steps:** list = `gl_entries` joined to accounts/centres with filters of 2.1.2; `Running Balance` = window `SUM(debit-credit) OVER (PARTITION BY account_id ORDER BY posting_date, seq)` when exactly one account filter is set and the range starts at FY start; if `from` is later than FY start, the opening balance is added (`SUM` before `from`); signed per normal balance (Asset/Expense `Dr` positive, others `Cr` positive; DTO also gives `side`). Views `movement` (per-month Σ), `ccsplit`, `compare`; `Status` derived (`Reversed` when the journal is Cancelled, `Reversal` when `is_reversal`). Integrity endpoint: per voucher Σ Dr = Σ Cr, entries whose journal is not Posted, reversal pairs complete.
**Tests:** after posting 3 journals: totals Σ debit = Σ credit; running balance of Cash after Dr 10,000 / Cr 2,500 = 7,500.00; filter by cost centre; reversal appears with `Reversal` and original `Reversed`; export xlsx has a totals row; POST -> 405.
**Accept:** green. **Do NOT:** compute balances in JS floats.

### T-FIN-12 Cost centres and profit centres pages (M)
**Depends:** T-FIN-11. **Rules:** BR-FIN-45, 2.1.11-12.
**Files:** `F/centers/definitions.ts`, `repository.ts`, `service.ts`, `handler-cost.ts`, `handler-profit.ts`, `routes.ts` (reclass endpoint `POST /finance/cost-centers/reclass`); tests `fin-centers.test.ts`.
**Steps:** CRUD per section 2; `Budget/Actual/Committed/Available` computed (queries to `budgets` return 0 until T-FIN-23: guard with `to_regclass`); tree + roll-up; `Revenue/Direct Cost/Allocated Cost/Contribution/Margin %` from `gl_entries` by `profit_center_id` and account report line (PL.100 revenue, PL.200 direct, allocated = `[ADD]` allocation rules table is COULD: Allocated Cost = 0 in v1); reclass journal `Adjustment` with percentage split summing to exactly 100.00, last target takes the remainder (BR-FIN-45); delete rules (`IN_USE`).
**Tests:** 10,000.00 split 33.33/33.33/33.34 -> 3,333.00 / 3,333.00 / 3,334.00 and journal balances; percentages sum 99.99 -> 422; margin: revenue 1,00,000, direct 60,000 -> contribution 40,000.00, margin 40.00 %; revenue 0 -> margin 0.
**Accept:** green. **Do NOT:** use floats for percentages (Decimal).

### T-FIN-13 Migration M3 and bank-account master (M)
**Depends:** T-FIN-12. **Files:** `.../20261110000200_fin03_cash_bank/migration.sql` (5.9 DDL: bank_accounts, payments, bank_statements, bank_statement_lines, bank_matches, FK `allocations.payment_id`, guarded `parties` FKs); `schema.prisma`; `F/bank/definitions.ts`, `repository.ts`, `service.ts`, `routes.ts` (`/finance/bank-accounts` GET/POST/PATCH/verify); tests `fin-bank-accounts.test.ts`.
**Steps:** account number encrypted with the existing secret helper (`env` key; if none exists use AES-256-GCM with `JWT_ACCESS_SECRET`-derived key and document it in the file header) and only `last4` returned; IFSC regex; `account_id` must be an active Asset account with sub type Bank/Cash and not already used (`DUPLICATE`); `verify` (second user, `delete` on fin-bankbook) sets `verified_by/at` (`verified_by <> created_by_id`, else 403 `MAKER_CHECKER`); seed demo bank accounts only in the test helper, not in production seed.
**Tests:** create bank account on 1111; same ledger account again -> 409; bad IFSC -> 422; verify by creator -> 403, by other -> ok; response never contains the full account number.
**Accept:** green. **Do NOT:** return `account_no_enc`.

### T-FIN-14 Payments, cash and bank books (L)
**Depends:** T-FIN-13, T-FIN-15 is **not** needed (open-items service is created here minimally in step 1). **Rules:** BR-FIN-10, 11, 39, 4.1.4 item 6.
**Files:** `F/openitems/service.ts` (create / settle / reverse allocation primitives; used again by T-FIN-15); `F/payments/definitions.ts`, `repository.ts`, `service.ts`, `routes.ts`; `F/books/definitions-cash.ts`, `definitions-bank.ts`, `handler-cash.ts`, `handler-bank.ts`; hooks registration in `F/accounting/hooks.ts` for open-item creation (replaces the T-FIN-04 no-op for step 11 of `postJournal`); `apps/api/tests/fin-payments.test.ts`.
**Steps:** 1) `OpenItemService.createFromLine`, `settle(tx,{sourceItemId,targetItemId,amount,date,paymentId})` (locks both rows `ORDER BY id FOR UPDATE`, checks outstanding, inserts allocation, increments both `settled_amount`, sets status `Settled` when outstanding 0), `reverseAllocation`. 2) `PaymentService.create` (kind PAYMENT, TRANSFER, receipt purpose OTHER only): validate mode/account (`MODE_ACCOUNT_MISMATCH`), bank-account verification (`BANK_ACCOUNT_UNVERIFIED`), cash rules (BR-FIN-11: `NEGATIVE_CASH` evaluated on the unit's cumulative cash incl. this payment, warning for per-day payments, `CASH_RECEIPT_LIMIT`), allocation rules (BR-FIN-10, FIFO suggestion function `suggestFifo(openItems, amount)`), `ADVANCE_NOT_CONFIRMED`; journal lines built in code: PAYMENT `Dr AP control (party, billMode AGAINST) amount / Cr bank amount`; TRANSFER `Dr counter account / Cr bank`; receipt OTHER `Dr bank / Cr chosen credit account` (field `creditAccountId` required); then settle allocations; for allocations on open items with `doc_type='purchase-invoices'` call `PurchaseInvoiceService.applyPayment` (plan 03; import guarded: if the module is absent skip and log); status `Posted`; number `PAY/RCP/CNT`. 3) `cancel` = reverse journal + `reverseAllocation` rows (+ SCM `applyPayment` negative? **plan 03 has no un-apply: payment cancellation is refused 409 `SETTLED_DOCUMENT` when any allocation touched a `purchase-invoices` item**; reverse via a debit note flow). 4) Books: `fin-cashbook` / `fin-bankbook` list handlers over `gl_entries` of accounts with sub type Cash / Bank (`Balance` running per account; `Cash In` = debit, `Cash Out` = credit; `Clearing Status` from `bank_matches`), views (`receipts`, `payments`, `transfers`, `uncleared`, `petty`, `position`, `count`), `POST /finance/payments`, `GET .../allocation-suggestion`, `POST .../allocate`, `POST .../cancel`, `POST /finance/cash-counts` (writes audit; optional difference journal).
**Tests (numbers):** cash payment 9,500 to vendor A then 1,000 -> second posts with warning `CASH_LIMIT_PAYMENT` (10,500 > 10,000); cash receipt 2,00,000.00 -> 422; cash balance 5,000 and payment 6,000 -> 409 `NEGATIVE_CASH`; FIFO: INV-1 40,000 (due 10 Oct), INV-2 60,000 (due 20 Oct), payment 70,000 -> allocations 40,000 + 30,000; payment 120,000 on a 100,000 total without `allowAdvance` -> 422; allocation 70,000 on item outstanding 60,000 -> `OVER_ALLOCATION`; unverified bank account and mode NEFT -> 422; duplicate UTR -> 409; cancel returns outstanding; book `Balance` after Dr 10,000 / Cr 2,500 = 7,500.
**Accept:** green. **Do NOT:** update `allocations` rows; skip row locks.

### T-FIN-15 Open items hooks, `fin-ar` and `fin-ap` pages (L)
**Depends:** T-FIN-14. **Rules:** BR-FIN-08, 10, 25, 26(flag), 4.4.7, 4.1.4 item 6.
**Files:** `F/openitems/definitions-ar.ts`, `definitions-ap.ts`, `repository.ts`, `handler-ar.ts`, `handler-ap.ts`, `routes.ts` (`/finance/open-items`); `F/events/side-records.ts` (sub-ledger hook for events: `AR`/`AP_CONTROL` lines + `payload.docNo/dueDate/partyId`; `RECEIPT_RECEIVED` creates the receipt item and `allocations` from `payload.allocations`); tests `fin-openitems.test.ts`.
**Steps:** list = `open_items` (side filter) with computed `Paid/Received`, `Outstanding`, `Age Days`, `Credit Limit` (from `parties`), `Collection Owner`; statuses; actions of 7.2 (`receive` is a link payload `{href:'/m/sales-collections', prefill}` in the action metadata, **not** a POST); `block/unblock/dispute/resolve/setOwner/promise/addToProposal/cancel` (Opening Bills only); Opening Bill create (`Add`) before `fin.go_live_date` posting an `Opening` journal Dr/Cr `3009`; views of 2.1.6-2.1.7 (`vendors`, `due`, `proposal`, `debitnotes`, `customers`, `exposure`, `allocation`, `creditnotes`); MSME due date set when supplier is micro/small (`parties.msme_*`): `doc_date + 45` (shorter agreed days from payload `paymentTermDays`).
**Tests:** sales-invoice event creates RECEIVABLE item `+14,603.00`; receipt event with allocation 14,603.00 settles it (status Settled, outstanding 0); credit note event creates `-` item; duplicate vendor invoice no. same supplier -> 409; block prevents a payment (`ITEM_BLOCKED`); opening bill after go-live -> 422; age days: due 2026-10-20, asOf 2026-11-02 -> 13; party sub-ledger sum = GL control balance (BR-FIN-36).
**Accept:** green. **Do NOT:** let Finance allocate a Sales receipt.

### T-FIN-16 Migration M4a and credit / debit note pages (L)
**Depends:** T-FIN-15. **Rules:** BR-FIN-30, 4.1.4 item 7, flow 4.6.
**Files:** `.../20261110000300_fin04_notes_expense_budget/migration.sql` (only 5.10 `credit_debit_notes`, `credit_debit_note_lines`; the other M4 tables are added by T-FIN-22/23/24 in `..._fin04b_...`/`fin04c`/`fin04d` folders); `schema.prisma`; `F/notes/definitions.ts`, `repository.ts`, `service.ts`, `handler-credit.ts`, `handler-debit.ts`, `routes.ts`; mirror hook in `F/events/side-records.ts` for `CREDIT_NOTE_POSTED`, `PURCHASE_RETURN_POSTED` (`source='AUTO'`); tests `fin-notes.test.ts`.
**Steps:** manual notes per flow 4.6 (original-rate tax recompute `r2(taxable*rate/100)`, CGST/SGST halves `r2(.../2)` with the second half = remainder, `CREDIT_EXCEEDS_INVOICE`, Section 34 date -> `is_commercial` and zero tax, maker-checker at `fin.note_approval_threshold`), posting via `postJournal` with BUILD rules `FIN_CREDIT_NOTE_POSTED` / `FIN_DEBIT_NOTE_POSTED` (5.20), open item `CREDIT_NOTE`/`DEBIT_NOTE` negative, automatic allocation to the referenced invoice item up to its outstanding, `tax_documents` creation hook (filled in T-FIN-27: call `hooks.taxDocument` if registered); AUTO mirrors read-only; views of 2.1.8.
**Tests:** invoice taxable 1,00,000 @18% intra; credit note 10,000 -> CGST 900, SGST 900, total 11,800.00; journal Dr 4107 10,000 / Dr 2301 900 / Dr 2302 900 / Cr 1201 11,800.00; second note 95,000 -> 422 `CREDIT_EXCEEDS_INVOICE`; date after 30 Nov of next FY -> GST 0, `is_commercial`; amount >= threshold: approve by other user; AUTO mirror from an event is not editable (409); reverse a posted manual note restores outstanding.
**Accept:** green. **Do NOT:** create notes for Sales/SCM-owned documents from Finance (they are mirrors).

### T-FIN-17 Bank reconciliation (L)
**Depends:** T-FIN-16. **Rules:** BR-FIN-19, 20; flow 4.5.
**Files:** `F/bankreco/definitions.ts`, `parser.ts` (CSV via a small tokenizer, XLSX via the existing `exceljs`), `import-service.ts`, `match-service.ts`, `summary.ts`, `handler.ts`, `routes.ts` (multipart via the existing upload middleware if any, else `multer` is **not** allowed: read the raw body with the existing file-upload helper used by Documents; if none exists write `QUESTION.`); tests `fin-bankreco.test.ts`, fixtures `apps/api/tests/fixtures/bank-statement-sample.csv`.
**Steps:** import (parse date formats, amounts, direction columns, `line_hash`, foot check, duplicate file/lines), `autoMatch` (scoring BR-FIN-20, greedy assignment), manual `match` (many-to-one both ways, `AMOUNT_MISMATCH` unless sums equal), `unmatch`, `accept/reject`, `create-voucher` from a line (bank charge journal Dr 6216 / Cr bank; interest Dr bank / Cr 4201; receipt/payment via `PaymentService`), `reconcile` (`RECON_DIFFERENCE`, `SUGGESTIONS_PENDING`, `PREVIOUS_STATEMENT_OPEN`; locks matches, sets `last_reconciled_date`), `reopen`, summary numbers (BR-FIN-19) recomputed on every change into the statement row.
**Tests:** the worked example of BR-FIN-19 (ERP 5,00,000; in transit +10,000; cheque -40,000; bank-only +5,000; bank 5,35,000 -> Difference 0.00 and reconcile OK); UTR example score 97 AUTO; 54 -> Suggested; two equal candidates -> both Suggested; duplicate file -> 409; non-footing file -> 422; reversing a journal with a reconciled bank line -> `RECONCILED_ENTRY`; two users matching the same entry concurrently -> second gets 409 (row lock).
**Accept:** green. **Do NOT:** change `gl_entries`; auto-match without direction check.

### T-FIN-18 Migration M8 SQL functions, `fin-trial`, integrity checks, consolidation (L)
**Depends:** T-FIN-17. **Rules:** BR-FIN-21, 36, 37.
**Files:** `.../20261110000700_fin08_report_sql/migration.sql` (functions of 5.14: `fn_trial_balance`, `fn_account_movement`, `fn_open_items_asof`, view `v_party_ledger`); `F/reports/trial-balance.ts`, `integrity.ts`, `definitions-trial.ts`, `handler-trial.ts`, `routes.ts`; tests `fin-trial.test.ts`.
**Steps:** TB list (hide zero, groups roll-up via account tree, `Status`), totals with `variance`, banner flag; views `opening|debit|credit|closing`; `/finance/integrity-checks` (BR-FIN-36 items 1,3,6,7 now; 2 in T-FIN-36; 4,5 later); cost/profit-centre filters; All Units for ADMIN+.
**Tests:** 5 journals incl. a reversal -> `Σ closing_debit = Σ closing_credit`; opening of an FY2 TB equals FY1 closing for BS accounts and 0 for P&L accounts when the FY1 closing journal exists (use direct inserts via `postJournal` of type Closing); variance 0.00; TB for unit TAL excludes unit SAW entries.
**Accept:** green. **Do NOT:** sum in JS.

### T-FIN-19 P&L and balance sheet (L)
**Depends:** T-FIN-18. **Rules:** BR-FIN-22, 23, 27(budget YTD).
**Files:** `F/reports/statement-engine.ts` (resolve `report_lines` to values: `ACCOUNTS`, `SUBTOTAL` components with sign, `SPECIAL CURRENT_PL`), `pnl.ts`, `balance-sheet.ts`, `definitions-pnl.ts`, `definitions-bs.ts`, handlers, routes; tests `fin-pnl-bs.test.ts`.
**Steps:** implement 5.16 statements with `fn_account_movement`; columns Current Month / YTD / Prior Year YTD / Budget YTD (0 when budgets table missing) / Variance / Variance %; BS Current vs Prior Period (`compare` PM or PY), Movement, Category, checks object `{balanceDifference, netProfit}`; views for the tabs of 2.1.16-17 (revenue breakdown by account and profit centre, COGS & gross margin by month, working capital ratios: current ratio = CA/CL 2 dp, quick = (CA - inventories)/CL, DSO/DPO/inventory days after T-FIN-21).
**Tests:** the P&L worked example of BR-FIN-23 (PAT 1,70,000.00) and the BS example of BR-FIN-22 (assets 100,000; equity 60,000; unclosed profit 40,000; difference 0.00); a closed FY contributes 0 to `BS.E.120`; closing journals excluded from P&L; reversing a journal changes nothing net.
**Accept:** green. **Do NOT:** hard-code account codes in the engine (use `report_line_code`).

### T-FIN-20 Cash flow (M)
**Depends:** T-FIN-19. **Rules:** BR-FIN-24. **Files:** `F/reports/cash-flow.ts`, `definitions-cashflow.ts`, handler, route; tests `fin-cashflow.test.ts`.
**Steps:** implement the indirect algorithm with `cf_class`; lines of 5.16 CF; `Forecast` = YTD / months elapsed x 12 for operating lines; check `closing - opening = netChange` returned as `checks.cashDifference`; Cash Forecast tab (13-week) = Σ open AR due per week - Σ open AP due per week + current cash (read-only).
**Tests:** the worked example (CFO 80,000.00; CFI -1,00,000.00; CFF 1,50,000.00; net 1,30,000.00; opening 10,000 -> closing 1,40,000), an Asset account with `cf_class='NA'` falls to CFO other and identity still holds.
**Accept:** green. **Do NOT:** include closing journals.

### T-FIN-21 Ageing and KPIs (M)
**Depends:** T-FIN-20. **Rules:** BR-FIN-25, section 8. **Files:** `F/reports/ageing.ts`, `kpis.ts`, `definitions-ageing.ts`, handler, routes (`/finance/ageing`, `/finance/kpis`); tests `fin-ageing.test.ts`.
**Steps:** ageing SQL of 5.14 with `fn_open_items_asof`; registry columns `1 30 Days`, `90 Plus` mapped; Status `Current/Overdue/Critical`; priority score; trend (month-end snapshots via `fn_open_items_asof` per month); KPIs per section 8 (those depending on later tables return `null` until their tickets).
**Tests:** BR-FIN-25 example buckets (50,000 -> 1-30; 30,000 -> Current; 20,000 -> 90+); a part-allocated invoice uses outstanding at `asOf` (historical asOf before the allocation date shows the full amount); DSO example 36.0; buckets total = party outstanding.
**Accept:** green.

### T-FIN-22 Expense management (M4b) (L)
**Depends:** T-FIN-21. **Rules:** BR-FIN-38; flow 4.13.
**Files:** migration `..._fin04b_expenses/migration.sql` (`expense_policies`, `expense_claims`); `schema.prisma`; `F/expenses/*` (definitions, repository, service, handler, routes); tests `fin-expenses.test.ts`.
**Steps:** CRUD, actions `submit` (policy), `approve`, `reject`, `post` (`EXPENSE_CLAIM_APPROVED` INLINE, open item with due `fin.expense_due_days`), `cancel`; duplicate bill; views of 2.1.13; ITC on claim only with valid GSTIN and non-blocked category.
**Tests:** Food limit 1,500; claim 1,800 -> `Exceeded`; same user approve -> 403; post -> journal Dr 6222 + Dr 1401/1402 (ITC) / Cr 2104; payment via `PaymentService` settles it; duplicate bill -> 409.
**Accept:** green.

### T-FIN-23 Budgeting (M4c) (L)
**Depends:** T-FIN-22. **Rules:** BR-FIN-27; flow 4.11.
**Files:** migration `..._fin04c_budgets/migration.sql` (`budgets`, `budget_months`, `budget_commitments`); schema; `F/budgets/*` (definitions, repository, service `BudgetService.check/commit/release/cancel`, handler, routes `/finance/budget/*`); hook `beforePost` in `F/accounting/hooks.ts`; tests `fin-budget.test.ts`.
**Steps:** CRUD + approve/close/cancel, monthly split (Σ months = amount exactly, last month remainder), the most-specific budget match, `check` per 4.11 (modes Ignore/Warn/Stop, `overrideBudget` with `delete` gate and reason), commitments lifecycle, views of 2.1.14, computed fields on cost-centre page now filled.
**Tests:** BR-FIN-27 example (budget 1,00,000 Stop, actual 70,000, committed 20,000: 15,000 -> `BUDGET_EXCEEDED`; 10,000 -> posts); Warn posts with warning stored in `journals.warnings`; Ignore none; override with reason posts and audits; two budgets (account-only and cost-centre+account) -> the specific one applies.
**Accept:** green.

### T-FIN-24 Period lock, fiscal-year close, opening balances (L)
**Depends:** T-FIN-23. **Rules:** BR-FIN-02, 28, 41; flow 4.7.
**Files:** migration `..._fin04d_closings/migration.sql` (`fiscal_year_closings`); schema; `F/periods/service.ts`, `routes.ts`; `F/opening/service.ts`, `routes.ts`; `F/accounts/handler.ts` views `posting-controls`, `opening`; tests `fin-close.test.ts`.
**Steps:** `lock/unlock/close` transitions (`INVALID_TRANSITION`), `closeFiscalYear` with pre-checks and per-unit closing journals (voucher type `Closing`, `is_closing=true` on the entries, number series `CLS`) per BR-FIN-28, FY status CLOSED; opening-balance grid and `post` (per unit `Opening` journal dated go-live minus one day; AR/AP/stock rows read-only; difference to `3009` only if <= 1.00); `ensureFiscalPeriods` job hook.
**Tests:** unit TAL income 12,00,000 / expenses 9,00,000 -> closing journal Cr 3004 3,00,000.00; closing blocked with a Draft journal in the FY (`CLOSE_BLOCKED` lists it); after close the next FY TB opening for 3004 = 3,00,000.00 and P&L accounts 0; posting into the closed FY -> `PERIOD_CLOSED`; opening post twice -> 409; difference 5.00 -> 422.
**Accept:** green. **Do NOT:** copy balances between FYs.

---

### T-FIN-25 Migration M5: tax core (L)
**Depends:** T-FIN-24 and plan 03 tables (`tax_codes`, `hsn_sac`, `tds_sections`, `parties`). **Rules:** BR-FIN-14.
**Files:** `.../20261110000400_fin05_tax_core/migration.sql` (guard; DDL 5.11: `gst_registrations`, ALTERs of `tds_sections`, `tax_documents`, `tax_document_lines`, `tax_ledger`, guarded FK `gst_registrations.default_tax_code_id -> tax_codes(id)`); `schema.prisma` (new models + the four fields added to plan 03's `TdsSection`); `apps/api/tests/fin-tax-schema.test.ts`.
**Steps:** copy the DDL; Prisma by the mechanical rule of 5.12; tests via SQL: GSTIN regex CHECK, `state_code` mismatch fails, one active registration per unit, `igst>0` with `cgst>0` fails (`tax_documents_split_check`), `tax_ledger` append-only, `tds_sections.kind` CHECK.
**Accept:** `db:reset:test` ok. **Do NOT:** recreate `tds_sections`.

### T-FIN-26 `tax-gst` and `tax-hsn` pages (L)
**Depends:** T-FIN-25. **Rules:** 2.2.1, 2.2.6, BR-FIN-14.
**Files:** `X/gst/definitions.ts`, `repository.ts`, `service.ts`, `handler.ts`, `routes.ts` (`/tax/gst/validate`, `/tax/pos/test`, `/tax/compliance-calendar`); `X/hsn/definitions.ts`, `repository.ts`, `service.ts`, `handler.ts`; `X/gstin.ts` (`validateGstin(gstin): boolean` with the mod-36 checksum: weights alternate 1,2 over the first 14 characters using the alphabet `0-9A-Z` (value = index); for each char `p = value * (1 if position even else 2)` (0-based), `digit = floor(p/36) + p % 36`, sum, check char = alphabet[(36 - sum % 36) % 36]; plus `pos` rules); tests `fin-tax-gst.test.ts`.
**Steps:** registration CRUD (GSTIN checksum 422 `GSTIN_INVALID`, state prefix `GSTIN_STATE_MISMATCH`, PAN derived, one active per unit, activate/deactivate with `IN_USE` when returns exist, AATO band, e-invoice/e-way flags); POS tester (`intra` iff supplier state = POS state); `tax-hsn` typed page over plan 03's `hsn_sac` (effective-dated rows: patching the rate of an old row is refused 422 `RATE_CHANGE_NEEDS_NEW_ROW`, create a new row), `Usage Count` = count of `items.hsn` + `tax_document_lines.hsn` matches, `endDate`; views of 2.2.1 / 2.2.6; compliance calendar (GSTR-1 11th, GSTR-3B 20th, QRMP 13th/22nd/24th, TDS 7th, TDS return 31 Jul/Oct/Jan/May, TCS 15 Jul/Oct/Jan/May (unverified)).
**Tests:** a published valid GSTIN `27AAPFU0939F1ZV` passes; flip one character -> fails; GSTIN `29...` with state Maharashtra -> mismatch; second active registration for the unit -> 409; HSN rate change on an existing row -> 422, new row ok; usage count; calendar for Nov 2026 contains 11 Nov, 20 Nov, 7 Nov.
**Accept:** green. **Do NOT:** call any GST portal.

### T-FIN-27 Tax documents from events, sales and purchase registers (L)
**Depends:** T-FIN-26. **Rules:** BR-FIN-14, 35, 4.1.3 `tax` block.
**Files:** `X/documents/repository.ts`, `service.ts` (`createFromEvent`, `cancelBySource`, `validateTaxBlock`); `F/events/side-records.ts` (register the tax hook for sales/purchase/credit/debit events and for manual notes); `X/documents/definitions-salesreg.ts`, `definitions-purchasereg.ts`, handlers; routes; tests `fin-registers.test.ts`.
**Steps:** map payload `tax` -> `tax_documents` + lines (registration chosen by `unitId` -> active `gst_registrations`, none -> FAILED `NO_GST_REGISTRATION`); validation BR-FIN-14 (`TAX_PAYLOAD_MISMATCH`), BR-FIN-35 filed-period block (needs T-FIN-28; guard `to_regclass('gst_returns')`); set `itc_*` for inward from the lines: eligible GST of eligible lines, `itc_eligibility` default `ELIGIBLE` (registered supplier) / `PENDING` when the supplier GSTIN is missing; credit/debit notes create `CRN`/`DBN` documents (negative effect handled by `doc_kind`, amounts stay positive); `cancelBySource` marks `Cancelled`; registers: list columns of 2.2.9-10 (credit notes shown negative), filters, totals, views; `2B Match` shows `Not Checked` until T-FIN-29.
**Tests:** sales invoice event with tax block (taxable 12,375.00; CGST/SGST 1,113.75) -> register row Total 14,602.50 + round-off 0.50 = invoice value 14,603.00; IGST and CGST both > 0 -> 422; sum mismatch -> 422; GSTIN-less B2C classified `B2CS`/`B2CL` by value and state; cancel event -> `Cancelled`; purchase register `ITC Eligible` = Σ itc heads; duplicate outward doc no -> 409.
**Accept:** green. **Do NOT:** recompute tax.

### T-FIN-28 Migration M6 and GSTR-1 (L)
**Depends:** T-FIN-27. **Rules:** BR-FIN-33, 35, 18 (late fee data), flow 4.8 steps 1-3.
**Files:** `.../20261110000500_fin06_returns/migration.sql` (all 5.12 tables; do GSTR-2B and TDS tables now so later tickets add no migration); `schema.prisma`; `X/gstr1/builder.ts`, `validator.ts`, `json-writer.ts`, `service.ts`, `definitions.ts`, `handler.ts`, `routes.ts`; tests `fin-gstr1.test.ts` + fixture expected JSON `apps/api/tests/fixtures/gstr1-expected.json`.
**Steps:** `prepare` (idempotent for non-Filed), classification (B2B, B2CL > `gst.b2cl_limit`, B2CS grouped by supply type/POS/rate, exports, CDNR/CDNUR, HSN summary by (hsn, uqc, rate), doc summary from number ranges), `validate` (issue codes of BR-FIN-33 + `DOC_NO_INVALID`), `generateJson` (7.9; numbers via `Decimal.toNumber()` only at serialisation; dates `DD-MM-YYYY`; stores text + sha256; blocked by errors 409 `RETURN_HAS_ERRORS`), `markFiled` (ARN 15+ chars? store as entered, filed date <= today, sets status Filed, locks outward documents of the period via BR-FIN-35), `revise`, `reopen` (before Filed only); page columns of 2.2.2; due date calc (11th next month; QRMP 13th after quarter) written to `due_date`.
**Tests:** BR-FIN-33 example (B2B 5,00,000; B2CS 1,00,000; credit note 20,000 -> liability 1,04,400.00); fixture JSON equals output byte for byte (sorted keys); an invoice with HSN of 3 digits for band LE_5CR -> `HSN_DIGITS`; B2CL threshold boundary 1,00,000 (not B2CL) vs 1,00,001 inter-state (B2CL); filed return then an invoice dated in the period -> 409 `GST_PERIOD_FILED`; `prepare` twice -> same totals; `markFiled` without ARN -> 422.
**Accept:** green. **Do NOT:** include cancelled documents; sum JSON numbers as floats.

### T-FIN-29 GSTR-2B import, matching, ITC eligibility (L)
**Depends:** T-FIN-28. **Rules:** BR-FIN-17, 34.
**Files:** `X/gstr2b/parser.ts` (GSTN 2B JSON: `data.docdata.b2b[].{ctin, trdnm, inv[].{inum, dt, val, pos, rev, itcavl, rsn, txval, igst, cgst, sgst, cess}}`, also `cdnr`; key names re-verify against a downloaded sample, section 15), `match-service.ts`, `itc-service.ts`, `routes.ts`; handler additions for `tax-purchasereg` (actions `setEligibility`, `claimInPeriod`); tests `fin-gstr2b.test.ts` + fixture `apps/api/tests/fixtures/gstr2b-sample.json`.
**Steps:** import (sha256 duplicate -> 409, supersede older), normalise doc no, match per BR-FIN-34 (statuses, diffs, tolerance setting), `Missing in Books` rows listed; `setEligibility` (`ELIGIBLE/INELIGIBLE/BLOCKED/PENDING`; claim needs `Matched` unless override by `delete` on tax-purchasereg with a reason (audited `ITC_OVERRIDDEN`); time bar 30 Nov of next FY -> 422 `ITC_TIME_BARRED`); rule 37 reversal list endpoint.
**Tests:** exact match; tax diff 5.00 -> `Value Mismatch` (diff stored), diff 0.50 with tolerance 1.00 -> `Matched`; same number different case/leading zeros -> match; different supplier GSTIN same values -> `GSTIN Mismatch`; book doc without 2B -> `Missing in 2B`; invoice 20-Mar-2026 claimed on 1-Dec-2026 -> `ITC_TIME_BARRED`; reversal example 2,745.76; re-import same file -> 409.
**Accept:** green.

### T-FIN-30 GSTR-3B compute, utilisation, tax ledger, settlement (L)
**Depends:** T-FIN-29. **Rules:** BR-FIN-15, 16, 17, 18, 35; flow 4.8 steps 6-9.
**Files:** `X/gstr3b/compute.ts` (pure `utilise(L, C, order)` returning movements), `service.ts`, `json-writer.ts`, `definitions.ts`, `handler.ts`, `routes.ts`; `X/taxledger/service.ts`; tests `fin-gstr3b.test.ts` (pure tests in `fin-gstr3b-pure.test.ts`).
**Steps:** `compute` (requires GSTR-1 Filed for periods >= 2025-07 else 409 `GSTR1_NOT_FILED`; outward from GSTR-1 snapshot; RCM from inward docs; ITC from inward docs with `ELIGIBLE` and (Matched or override) in the claim period, plus carried balance from `tax_ledger`; reversals; Tables 3.1, 4, 5, 6.1 into the columns of `gst_returns` and `utilisation` json); `utilise` (BR-FIN-15 exactly; checks `CASH_LEDGER_SHORT`; writes `tax_ledger` rows (ITC debit `ITC_UTILISED`, LIABILITY credit, CASH debit) and the settlement journal (4.8 step 8), idempotent per return); `POST /tax/gst-cash/deposit`; interest/late fee (BR-FIN-18 helper `gstInterest`, `gstLateFee`), `generateJson` (3B JSON: `gstin, ret_period, sup_details, itc_elg, intr_details`, keys re-verify), `markFiled`, `reopen` before filed; page columns of 2.2.3 (`Outward Tax`, `Reverse Charge`, `Eligible ITC`, `Ineligible ITC`, `Net Tax Payable`, `Cash Paid`, `Credit Utilized`).
**Tests (pure):** example A -> cash 25,000, credit used 85,000; example B -> cash 25,000 (SGST), carried CGST credit 5,000; IGST credit used before any CGST credit; CGST credit never against SGST; cess credit only against cess; SGST_FIRST order variant. **Integration:** compute blocked without Filed GSTR-1; settlement journal balances and zeroes output accounts of the period; second `utilise` is a no-op; interest 61.64 and late fee 250 (BR-FIN-18 example).
**Accept:** green. **Do NOT:** use credit ledger across GSTINs.

### T-FIN-31 TDS: register, `TdsService`, challans, return data (L)
**Depends:** T-FIN-28 (tables), plan 03 `tds_sections` seed. **Rules:** BR-FIN-12, 12b; flow 4.9; 4.1.4 item 5.
**Files:** `X/tds/compute.ts` (pure), `service.ts`, `repository.ts`, `definitions-tds.ts`, `handler.ts`, `challan-service.ts`, `return-service.ts`, `routes.ts`; seed additions (`new_section`, `payment_code`, `return_form`, TCS rows) in `phase8-finance-defaults.ts`; side-record hook for `payload.tds` in `F/events/side-records.ts`; tests `fin-tds.test.ts`, `fin-tds-pure.test.ts`.
**Steps:** `computeTds` pure per BR-FIN-12 (thresholds, modes ON_ALL/ON_EXCESS, no-PAN, individual rate by PAN 4th character, `round0` half-up per D-FIN-5); `record` writes `tds_entries` (+ code `TDS/<UNIT>/<FY>/0001`); event hook copies `payload.tds` (no recompute); Finance-originated callers use `TdsService.compute` + `record`; register page columns of 2.2.4; actions `linkChallan` (via challan service), `cancel` (before challan; reverses the journal line? **TDS payable credit belongs to the purchase journal**: cancelling an entry only flags it `Cancelled` and requires the source document to be cancelled first: 409 `SOURCE_ACTIVE` otherwise), `recompute`; challan: `POST /tax/challans` (BR-FIN-12b; payment document purpose TDS `Dr 2311 / Cr bank`; interest/fee `Dr 6263`), returns: `prepare` builds the CSV of 7.10 and validations, `file` (token no + date) sets entries `Return Filed`; compliance tab data (due dates, late interest estimates 1% / 1.5% per month or part); seeds fill columns.
**Tests (pure, numbers of BR-FIN-12):** the 5-row 194C table (0, 0, 0, 2,140, 400); single payment 35,000 -> 700; 194Q 40,00,000 then 20,00,000 -> second TDS 1,000; 194J-B 50,000 -> 0 then +10,000 -> 6,000; no PAN 80,000 at 20% -> 16,000 flagged; individual PAN `AAAPA1234A` on 194C -> 1%; threshold across FY boundary resets. **Integration:** event with tds block creates an entry and `cumBefore` from earlier entries; challan with Σ mismatch -> 422; entry in two challans impossible; return CSV header and row order; deposit due date 7 Dec for a Nov deduction, 30 Apr for March.
**Accept:** green. **Do NOT:** recompute TDS for plan-03 invoices; use floats.

### T-FIN-32 TCS page (M)
**Depends:** T-FIN-31. **Rules:** BR-FIN-13 (amended), 2.2.4. **Files:** `X/tcs/*` (definitions-tcs, handler reuse of tds service with `kind='TCS'`), seeds for TCS sections (5.19, no `206C(1H)`), tests `fin-tcs.test.ts`.
**Steps:** manual TCS entry (collectee, section, receipt date, amount, rate lookup, amount `round0(base*rate/100)`, no-PAN rate), challan/return with form `27EQ` (text configurable), tabs of 2.2.4; no automatic TCS on invoices.
**Tests:** scrap 1,00,000 at 1% -> 1,000; no TCS section with code containing `1H`; challan and return flows as TDS with kind TCS; mixing kinds in one challan -> 422.
**Accept:** green.

### T-FIN-33 Migration M7 and e-invoice workspace (L)
**Depends:** T-FIN-32. **Rules:** BR-FIN-31; flow 4.10 steps 1-4; 4.1.4 item 9.
**Files:** `.../20261110000600_fin07_einvoice_eway/migration.sql` (5.13); schema; `X/einvoice/json-builder.ts` (IRP INV-01 1.1), `service.ts`, `definitions.ts`, `handler.ts`, `routes.ts`; `X/adapters/gst-portal-adapter.ts` (7.11); hook in the tax-document creation (create `einvoice_records` when applicable); tests `fin-einvoice.test.ts` + fixture `apps/api/tests/fixtures/irp-expected.json`.
**Steps:** applicability (registration `e_invoice_enabled`, B2B/export/SEZ, notes), `due_by` rule (`GE_10CR` -> +30 days), `generateJson` (field list of 4.10 step 2; amounts 2 dp; date `DD/MM/YYYY`; `SupTyp`), `enterIrn` (64 hex, Ack No, Ack Date >= invoice date, late flag, calls the Sales service `recordIrn` when available, updates `tax_documents.irn` and mirror), `markError`, `requestCancel` (24 h rule `CANCEL_WINDOW_PASSED`), `confirmCancel`, `markNotApplicable`; QR tab renders the signed QR string as an image client-side later; KPI counts.
**Tests:** fixture JSON equality for the sample invoice; invalid IRN length -> 422; ack date before invoice date -> 422; late IRN (31 days) stored `late=true`; cancel after 25 hours -> 409; B2C invoice creates no record; grep test: no `fetch(`/`http`/`https` import under `modules/tax/**`.
**Accept:** green. **Do NOT:** call the IRP.

### T-FIN-34 E-way bill workspace (M)
**Depends:** T-FIN-33. **Rules:** BR-FIN-32; flow 4.10 step 5.
**Files:** `X/eway/validity.ts` (pure), `json-builder.ts`, `service.ts`, `definitions.ts`, `handler.ts`, `routes.ts`; seed `eway_validity_rules` (Normal 200, ODC 20, from 2021-01-01); job `markExpiredEwb`; tests `fin-eway.test.ts`.
**Steps:** draft from tax document when `consignment_value > threshold` (state override map), JSON (field list 4.10 step 5), `enterEwb` (12 digits, generated datetime, computes `valid_until` by rules table; mirrors to Sales dispatch via `recordEwb` when present), `updatePartB` (vehicle regex), `extend` (window check), `cancel` (24 h), exceptions tab (> 50,000 without EWB).
**Tests:** 450 km normal generated 2026-11-02 10:30 -> valid until 2026-11-05 00:00; 199 km -> 1 day; 201 km -> 2 days; ODC 45 km -> 3 days; value 50,000.00 exactly -> not required, 50,000.01 -> required; bad vehicle no -> 422; extend outside window -> 409; expired job sets status.
**Accept:** green.

### T-FIN-35 MSME interest, GST interest and late-fee helpers, alerts (M)
**Depends:** T-FIN-31. **Rules:** BR-FIN-18, 26. **Files:** `F/msme/service.ts`, `routes.ts` (`/finance/msme/overdue-at-year-end`, `POST /finance/msme/post-interest`), `X/gst/interest.ts` (pure `gstInterest`, `gstLateFee`), tests `fin-msme.test.ts`.
**Steps:** MSME due date maintenance (job fills `msme_due_date`), interest formula of BR-FIN-26 with whole months and day remainder, report, alerts count for KPIs, posting `Dr 6253 / Cr 2101` only on request; GST interest/late-fee pure helpers used by T-FIN-30.
**Tests:** 1,00,000 at bank rate 6.50% two months -> 3,276.41; 45 days + 1 day overdue flagged; non-MSME and medium supplier -> none; interest 61.64 and late fee 250; caps apply (late fee cap 2,000 at AATO <= 1.5 Cr for 60 days).
**Accept:** green.

### T-FIN-36 Inventory valuation = GL, sub-ledger and GST agreement checks (M)
**Depends:** T-FIN-35. **Rules:** BR-FIN-36. **Files:** `F/reports/integrity.ts` (complete), `F/reports/stock-gl.ts`, route `/finance/integrity-checks`, tests `fin-integrity.test.ts`.
**Steps:** (2) `Σ stock_balances.value` by unit (warehouse unit) vs GL balance of accounts 1301..1308,1310 by unit within `fin.stock_gl_tolerance`; list per account group; (4) bank vs reconciliation; (5) GST ledgers vs `tax_ledger`; return `{check, key, expected, actual, difference}` rows; severity.
**Tests:** after GRN + delivery events drained, stock value = GL inventory (e.g., 10,600.00 in, 4,000.00 out -> 6,600.00 both); a manual journal into 1301 creates a difference row; AR sub-ledger vs control mismatch detected after a direct SQL tamper in a test transaction.
**Accept:** green.

### T-FIN-37 KPI endpoint completion and dashboard chips (S)
**Depends:** T-FIN-36. **Files:** `F/reports/kpis.ts` (all section 8 items), `apps/api/tests/fin-kpis.test.ts`. **Steps:** implement remaining KPIs, null-safe for missing data; **Tests:** the DSO 36.0 example, ITC available vs claimed gap, TDS payable grouped by due date, 2B mismatch counts, pending postings count. **Accept:** green.

### T-FIN-38 Exports: xlsx and PDF hooks (M)
**Depends:** T-FIN-37. **Files:** `F/export.ts` (copy `inventory/export.ts` pattern, indent by level, totals row, ₹ format, `safeCell`), `F/export-pdf.ts` (501 `NOT_IMPLEMENTED` when the letterhead service is absent), route wiring for the 29 pages (`GET /records/export.xlsx`), tests `fin-export.test.ts`.
**Tests:** TB export has header with registry labels, totals row, money numeric cells; formula injection `=1+1` in narration prefixed with `'`; 10,001 rows -> 413.
**Accept:** green.

### T-FIN-39 Web: live tabs, disabled report buttons, `[ADD]` buttons (L)
**Depends:** T-FIN-38. **Rules:** section 1.2, 2.0, FC-4.
**Files:** `apps/web/src/pages/generic/fieldModel.ts` (`isLiveTab` honours `schema.tabViews`), `apps/web/src/pages/generic/ViewTab.tsx` (new: table from `views[key].columns`, filters, totals, export, paging; reuses `RegisterTab` styles/classes only), `apps/web/src/pages/generic/GenericModulePage.tsx` (render `ViewTab` for mapped tabs; disabled `Add/Edit/Delete` with `title="Report — post a voucher instead"` for `schema.readOnly` pages; `[ADD]` header buttons from `schema.headerActions`), `apps/web/src/pages/generic/engineApi.ts` (types `tabViews`, `headerActions`), `apps/web/src/pages/finance/FinanceBanners.tsx` (red out-of-balance banner), `apps/web/src/pages/generic/Views.test.tsx`/new `FinancePages.test.tsx`.
**Steps:** no new CSS classes; reuse existing `notice`, `btn`, `table` classes; banners use `notice`; `headerActions` are rendered after the frozen buttons in the order given by the schema; `Post pending` badge on `fin-journal` calls `POST /finance/queue/drain`.
**Tests (vitest + RTL):** report page buttons disabled with the tooltip, Excel/Print enabled; mapped tab shows the view table with API data; unmapped legacy page unchanged; headerActions order after `＋ Add`; banner appears when `variance != 0`.
**Accept:** `cd apps/web && npm run verify` green; existing Playwright screenshot baselines for non-finance pages unchanged. **Do NOT:** change CSS files or other families' pages.

### T-FIN-40 Web: journal editor, payment modal, bank reconciliation workspace, tax workspaces (L)
**Depends:** T-FIN-39. **Files:** `apps/web/src/pages/finance/JournalEditor.tsx`, `PaymentModal.tsx`, `BankRecoWorkspace.tsx`, `ImportStatementModal.tsx`, `OpeningBalancesGrid.tsx`, `PeriodGrid.tsx`, `apps/web/src/pages/tax/ReturnWorkspace.tsx`, `ChallanForm.tsx`, `IrnEntryForm.tsx`, `EwbEntryForm.tsx`, `apps/web/src/pages/finance/api.ts`, tests `FinanceForms.test.tsx`.
**Steps:** journal editor with live Σ Debit / Σ Credit / Difference (Decimal-safe string arithmetic: use `decimal.js` only if already a dependency; otherwise integer paise arithmetic helper `toPaise/fromPaise`), Save/Post disabled while difference `!= 0.00`; payment modal with FIFO suggestion and editable allocation grid and live unallocated; bank reco two-pane with multi-select and Match/Unmatch and live Difference; forms use the existing `Modal`, `RecordFormModal` field components and error display (`toUiError`), the registered page tab hooks (`registerTabName`/`tabViews`) to mount the custom workspaces **inside** the frozen tab content only.
**Tests:** difference display `0.01` disables Post; FIFO suggestion shown 40,000 + 30,000; Match button disabled until sums equal; IRN input rejects 63 hex chars.
**Accept:** web verify green. **Do NOT:** add a CSS framework or restyle.

### T-FIN-41 Demo seed, simulation and property tests (L)
**Depends:** T-FIN-40. **Files:** `apps/api/tests/fin-simulation.test.ts`, `apps/api/tests/fin-helpers.ts`, optional `apps/api/src/core/seed/phase8-demo.ts` (dev only, never in production seed).
**Tests:** (S1) 10,000 random vouchers (seeded PRNG): manual journals, sales/purchase events with random GST and round-off, receipts, payments, credit notes, reversals: after drain **every journal balances**, **TB variance 0.00**, **BS equation 0.00**, sub-ledger = control accounts, `settled_amount = Σ allocations`, no open item with negative outstanding beyond its amount; (S2) 200-operation run with reversals: ledger balance of every account equals Σ of non-reversed minus reversals; (S3) Inventory valuation = GL after random GRN / delivery / adjustment events (if Inventory services available; else uses event samples); (S4) concurrency: 20 parallel postings to one period -> numbers gap-free and unique.
**Accept:** runs under 4 minutes; green. (Runs only in `npm run verify` when `FIN_SIM=1`; default CI runs a 500-voucher variant.)

### T-FIN-42 API end-to-end scenarios E1-E10 (L)
**Depends:** T-FIN-41. **Files:** `apps/api/tests/fin-e2e-scenarios.test.ts` implementing section 11.3 scenarios with the numbers given there. **Accept:** green; every scenario asserts journal lines and balances exactly.

### T-FIN-43 SHOULD: recurring journals and bank rules (M9) (M)
**Depends:** T-FIN-17. **Files:** `.../20261110000800_fin09_should/migration.sql` (`recurring_journals(id, STD, unit_id, name, template jsonb, frequency 'MONTHLY'|'QUARTERLY'|'YEARLY', next_run date, end_date, auto_post bool, status)` and `bank_rules(id, STD, bank_account_id null, name, priority int, match jsonb {descriptionContains, minAmount, maxAmount, direction}, action jsonb {accountId, partyId, costCenterId, narration}, status)`), schema, `F/recurring/*`, `F/bankreco/rules.ts` (rule matching after auto-match: creates a SUGGESTED voucher, never posts silently), tests `fin-recurring.test.ts`.
**Tests:** monthly template creates a Draft/posted journal on `next_run` and advances it; rule `descriptionContains 'SMS CHARGES'` suggests Dr 6216; no double run on the same date.
**Accept:** green.

### T-FIN-44 SHOULD: payment proposals, vendor advance TDS netting, Form 16A data (M)
**Depends:** T-FIN-31, T-FIN-15. **Files:** `F/payments/proposals.ts`, `X/tds/certificate-data.ts`, routes, tests `fin-proposals.test.ts`. **Steps:** proposal (group due items per vendor, skip blocked, apply debit notes first, TDS already deducted), release posts one payment per vendor; advance payment creates a TDS entry and the later invoice nets it (BR-FIN-12 item 7); 16A data export CSV per deductee per quarter. **Tests:** two vendors, one blocked; netting example (advance 50,000 deducted 5,000; invoice 1,00,000 -> deduct only on remaining 50,000). **Accept:** green.

### T-FIN-45 Playwright end-to-end (M)
**Depends:** T-FIN-42, T-FIN-40. **Files:** `tests/e2e/finance.spec.ts`. **Flows:** login Finance user -> `fin-journal` add balanced journal (live difference) -> post -> appears in `fin-gl` and `fin-trial` (variance 0) -> report page buttons disabled with tooltip -> cash book `＋ Payment` -> bank reco import fixture -> reconcile -> `tax-gstr1` prepare/validate/JSON -> `tax-tds` challan; screenshot comparison of each of the 29 pages' first profile tab against `reference/screens/v92/` where a baseline exists. **Accept:** `npm run e2e` green (one Playwright process).

### T-FIN-46 SHOULD: multi-currency, audit-trail export, journal CSV import (M)
**Depends:** T-FIN-42. **Rules:** BR-FIN-09, 40. **Files:** `F/fx/service.ts` (revaluation journal), `F/audit/export.ts` (CSV/XLSX of `JOURNAL_*` audit rows with user, time, ip for ADMIN+), `F/journals/import.ts` (CSV `date,account,debit,credit,party,costcenter,narration,ref` grouped by `ref` into Draft journals; every group must balance else the whole file is rejected with the line numbers), tests `fin-fx-import.test.ts`.
**Tests:** USD 1,000 at 83.20 -> ₹83,200.00, revaluation at 84.00 -> 800.00 gain journal auto-reversed next month; import with one unbalanced group -> nothing created; audit export row count equals audit rows.
**Accept:** green.

---

### 12.1 Ticket dependency and size index

| Ticket | Title | Depends | Size |
|---|---|---|---|
| T-FIN-01 | M1 migration COA/periods | - | M |
| T-FIN-02 | Seeds | 01 | M |
| T-FIN-03 | M2 ledger migration + triggers | 02 | L |
| T-FIN-04 | AccountingService core | 03 | L |
| T-FIN-05 | Queue columns, `post`, schemas | 04 | M |
| T-FIN-06 | Rules engine + seeds | 05 | L |
| T-FIN-07 | Queue drain | 06 | L |
| T-FIN-08 | Typed-page infrastructure | 07 | L |
| T-FIN-09 | fin-journal | 08 | L |
| T-FIN-10 | fin-coa | 09 | L |
| T-FIN-11 | fin-gl | 10 | M |
| T-FIN-12 | cost / profit centres | 11 | M |
| T-FIN-13 | M3 migration + bank accounts | 12 | M |
| T-FIN-14 | Payments, cash/bank books | 13 | L |
| T-FIN-15 | fin-ar / fin-ap | 14 | L |
| T-FIN-16 | M4a + credit/debit notes | 15 | L |
| T-FIN-17 | Bank reconciliation | 16 | L |
| T-FIN-18 | M8 SQL + fin-trial | 17 | L |
| T-FIN-19 | P&L + BS | 18 | L |
| T-FIN-20 | Cash flow | 19 | M |
| T-FIN-21 | Ageing + KPIs | 20 | M |
| T-FIN-22 | Expenses | 21 | L |
| T-FIN-23 | Budgeting | 22 | L |
| T-FIN-24 | Periods, FY close, opening | 23 | L |
| T-FIN-25 | M5 tax core | 24 | L |
| T-FIN-26 | tax-gst + tax-hsn | 25 | L |
| T-FIN-27 | Tax documents + registers | 26 | L |
| T-FIN-28 | M6 + GSTR-1 | 27 | L |
| T-FIN-29 | GSTR-2B + ITC | 28 | L |
| T-FIN-30 | GSTR-3B | 29 | L |
| T-FIN-31 | TDS | 28 | L |
| T-FIN-32 | TCS | 31 | M |
| T-FIN-33 | M7 + e-invoice | 32 | L |
| T-FIN-34 | E-way bill | 33 | M |
| T-FIN-35 | MSME / GST interest | 31 | M |
| T-FIN-36 | Stock = GL and integrity | 35 | M |
| T-FIN-37 | KPIs | 36 | S |
| T-FIN-38 | Exports | 37 | M |
| T-FIN-39 | Web live tabs | 38 | L |
| T-FIN-40 | Web forms and workspaces | 39 | L |
| T-FIN-41 | Simulation / property tests | 40 | L |
| T-FIN-42 | API e2e scenarios | 41 | L |
| T-FIN-43 | Recurring + bank rules (SHOULD) | 17 | M |
| T-FIN-44 | Proposals, 16A data (SHOULD) | 31, 15 | M |
| T-FIN-45 | Playwright | 42, 40 | M |
| T-FIN-46 | FX, audit export, CSV import (SHOULD) | 42 | M |

Rule coverage: BR-FIN-01..08 -> T-FIN-04; 05 -> 05/07; 09 -> 46; 10, 11, 39 -> 14; 12, 12b -> 31; 13 -> 32; 14 -> 27; 15, 16 -> 30; 17 -> 29/30; 18 -> 30/35; 19, 20 -> 17; 21 -> 18; 22, 23 -> 19; 24 -> 20; 25 -> 21; 26 -> 35; 27 -> 23; 28, 41 -> 24; 29 -> hook only (mapping tested in 06); 30 -> 16; 31 -> 33; 32 -> 34; 33 -> 28; 34 -> 29; 35 -> 28/30; 36 -> 18/36; 37 -> 04/18; 38 -> 22; 40 -> 46; 42 -> 10; 43 -> 09; 44 -> 08; 45 -> 12.
