# ERRATA
# ERRATA — fixes found when the phase files were checked against each other
Every builder reads this file together with STANDARDS.md. If a phase file says otherwise, this file wins.

E-01 Migration names. Take the timestamp at build time: <YYYYMMDDHHMMSS>_phaseNN_<name>.
     Ignore every example timestamp in the phase files (Phase 4 and Phase 7 both show 20261201000000).
E-02 File paths. Phase files live in docs/phases/. After Phase 0, old documents live in docs/archive/
     (PLAN.md, docs/plan/*, docs/plans/*, docs/phase1..3-4/*, DEPLOYMENT-REVIEW.md).
     Any reference to docs/plans/PHASE-xx or docs/plan/phase-03.md means docs/phases/PHASE-xx.md.
E-03 Commits. A builder never commits unless the owner asks in that message, and never pushes.
     This overrides "commit on branch phase-05-approvals" in Phase 5.
E-04 Role names. Phases 1 and 3 run before Phase 2, so they use the old names SUPER_ADMIN and ADMIN.
     After Phase 2 these become level ≥ 99 (Super User) and level ≥ 95 (Administrator).
     MFA eligibility = level ≥ 95.
E-05 gst_states and the GSTIN/PAN validators are built in PHASE 3 (packages/statutory,
     using the algorithm and test vectors written in Phase 6 §5). Phase 6 reuses them and does not create gst_states again.
E-06 UOM. Phase 3 creates uoms (with uqc_code) and uom_conversions (general, class-based).
     Phase 6 does NOT run "ALTER uoms ADD uqc". Phase 6 only adds item_uom_conversions (item-specific).
E-07 Files. Phase 3 creates the table stored_files (columns: id, sha256, size_bytes, mime, ext,
     storage_key, scan_status default 'skipped', created_at, created_by_id) for the logo and signature,
     through a minimal LocalDiskStorage. Phase 4 extends the same table and service. No table named "files".
E-08 Posting in soft-closed months. There is ONE gate: Phase 3 assertCanPost(). Posting in a
     soft-closed month needs permission action `post` on page admin-fy.
     Default rows: CFO, Director, Administrator. Phase 7 uses this gate and has no separate "fin.override_soft_close".
E-09 Numbering. Phase 3 NumberingService.allocate() is the only allocator.
     Phase 7 journal vouchers and every later document use it (allocate_on POST for GST documents).
E-10 Account keys (Phase 7 seeds all of these; Phase 8 uses exactly these names):
     INVENTORY_RM, INVENTORY_WIP, INVENTORY_FG, STOCK_IN_TRANSIT (→ 1309 Materials in Transit),
     STOCK_ADJUSTMENT (Phase 7's STOCK_ADJUSTMENT_GAIN_LOSS is renamed to this),
     CONSUMPTION_EXPENSE (Phase 8's "STORES_CONSUMPTION" means this),
     OPENING_BALANCE_EQUITY (Phase 8's "OPENING_BALANCE" means this).
     Phase 7 posting rules map these keys directly; no itemType condition is needed for inventory.
E-11 Submit/approve endpoints. Phase 4 builds POST /pages/:p/records/:id/submit.
     Phase 5 adds /approve, /reject, /return and /withdraw on the same path, plus the
     /approvals/... endpoints. Phase 5 replaces the Phase 4 default submit hook.
     Phase 5 also extends the Phase 4 lock matrix; it does not rebuild it.
E-12 pg-boss is added in Phase 4. Phase 1's daily cleanup timer moves to pg-boss in Phase 4.
E-13 Approved now (architect ruling D-26): customers and suppliers are two separate tables.
     Phase 6's three new pages (admin-payment-terms, admin-banks, admin-party-groups) and the
     reuse of crm-customer360 as the Customer Master wait for the OWNER's yes before Phase 6 starts.
E-14 Phase 3's build prompt mentions "register/lock via comms". Ignore it; that rule belongs to another repo.
E-15 pdfkit + Noto fonts are first installed in Phase 3 (letterhead test PDF). Phase 4 builds PdfService on them.
E-16 Statutory values (GST slabs, HSN rates, TDS sections, PF/ESIC/PT, depreciation lives) are seeded
     with needs_review=true. The owner's accountant signs them off before the phase that uses them goes live.

 E-17 Phase 20 §4.3 (command idempotency in DB) is ALREADY built in Phase 4 (C7 fix). Phase 20 only
     verifies it works across 2 processes; it does not rebuild it.
E-18 Phase 19: remove every company_id column (R-01). ai_settings is a single-row table.
E-19 Phase 18 gate passes / challans use the Phase 3 GST doc types gate-out and gate-return
     (not "delivery_challan"). Number ≤16 chars via NumberingService.
E-20 Dimensions project_id and amc_contract_id (Phase 17) are added to BOTH journal_lines and
     gl_entries, because all Phase 7 reports read gl_entries only.
E-21 Phases 14 and 16 build prompts mention "register/lock/heartbeat", "push command" or ".replit".
     Ignore them (other repo). Never push.
E-22 New account keys are registered by the phase that first uses them, in its own migration:
     Phase 9 LANDED_COST_CLEARING, ITC_INELIGIBLE_EXPENSE, ITC_REVERSED_180; Phase 12
     QMS_REWORK_EXPENSE; Phase 15 EMPLOYEE_PAYABLE, EMPLOYEE_ADVANCE; Phase 16 PT_PAYABLE,
     LWF_PAYABLE, EMPLOYEE_LOAN, BONUS_PAYABLE, GRATUITY_PROVISION.
E-23 itc_reversals is created in Phase 9. Phase 11 only ALTERs it (adds kinds R37A, S17_5, MANUAL);
     it does not recreate it.
E-24 Inter-unit stock transfers between units with DIFFERENT GSTINs need a tax invoice (Phase 11).
     Until Phase 11 is live, Phase 8 refuses such transfers with: "Transfer between different GSTINs
     needs a tax invoice; available after the Taxation phase." Same-GSTIN transfers work normally.
E-25 Holiday calendars are owned by Phase 15 (one per unit per year). Phase 13 work-centre calendars
     and Phase 17 SLA calendars read holidays from there. Before Phase 15 exists, they use weekdays only.
E-26 Phase 12 API base path is /api/v1/qms (not /api/qms).
E-27 Phase 14 adds assets.id as an FK on Phase 13 work_centres (machines live in assets).
E-28 Phase 11 §10 mentions a "no test files" memory. That belongs to another project; this project
 E-28 Phase 11 §10 mentions a "no test files" memory. That belongs to another project; this project
     writes tests as STANDARDS §11 says.
E-29 Phase 16 worked example: employee C's PF wage is 1,18,400 (Basic 60,000 + Special 58,400);
     contribution is on the 15,000 ceiling. The "88,400 → 118,400?" cell is a typo.
E-30 Every date-based legal claim in Phases 9–20 (Labour Codes effective 21-Nov-2025, DPDP Rules
     13-Nov-2025, Income-tax Act 2025 section numbers, GST 2.0 rates 22-Sep-2025, e-way 180/360 days,
     GSTR-3B hard-lock) is needs_review data. The CA / HR head / legal confirms before go-live.
E-31 Owner decisions still open (the builder must ask, never assume):
     Phase 6 new pages + crm-customer360 reuse; Phase 7 journal approval threshold; Phase 11 whether
     units share one GSTIN; Phase 12 AQL value of the old sheet; Phase 16 PF wage basis, days basis,
     bonus %; Phase 20 RDS vs EC2 Postgres, cut-over date (proposed 1-Apr-2027).
E-32 Client requirements added 2026-11-06 (see ROADMAP §4 and the "Client requirements" section of each phase file).
     New phase 6B (Format & Settings engine) runs between Phase 6 and Phase 7 without renumbering anything.
     Owner decisions still open (the builder must ask, never assume): (a) job work / customer-supplied material
     placement (Phase 8 stock flag vs Phase 13 module); (b) who owns Minutes of Meeting and Continuous
     Improvement forms (Quality vs Projects vs generic pages); (c) the first client Excel files to import as
     formats (Phase 6B); (d) whether publishing a money-affecting rule set needs approval (default yes);
     (e) the powder list and rates need the client's confirmation before any load.
E-33 Phase 7 -> 11 hand-over (2026-11-06, owner). Finance (Phase 7) built the tax REGISTERS only (sales/purchase register, TDS/TCS register, challans).
     GSTR-1/3B, e-invoice, e-way bill, GSTR-2B/ITC matching and TDS/TCS return files are Phase 11; the list is in PHASE-11.md section A.
E-34 Approval limits are owned by the administrator. fin.journal_approval_threshold and fin.note_approval_threshold are set on the screen
     System Setup > Finance Approval Limits (Super User / Administrator). Unset = that document never asks for approval; code never sets them.



     E-35 Pagination (E-34) was not applied: the 11-Nov scan found 129 of 162 findMany lists with no limit.
     Phase 22 fixes it; every later phase is blocked until the unbounded-list check is green.
E-36 STATUS.md is generated at the end of every phase; never hand-edited.
E-37 PHASE-22.md (currently empty) is replaced by Release 2 Phase 22.
E-38 The web app gets @tanstack/react-query v5 (Phase 22), @tanstack/react-virtual (Phase 22) and
     chart.js 4.x behind one <Chart> component (Phase 24). The useLoad hook becomes a thin wrapper.
E-39 New page families: Work Management, Workplace Management, Integrated Plant Flow,
     Business Documents, Contract Labour Management, plus Department Inbox and Department Work
     (generated from the departments table).
E-40 user_preferences.unit_id / all_units are replaced by user_preferences.unit_ids uuid[] (Phase 23).
     The old columns stay one release for rollback, then are dropped in Phase 32.
E-41 The earlier R2 drafts that put a department dropdown and a "Request Access" tab on the login
     screen are cancelled by R-30.

 