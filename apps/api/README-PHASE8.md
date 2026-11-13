# Phase 8 — Inventory & WMS v2 (developer notes)

Spec used: `docs/phases/PHASE-08.md` (client requirements) + the archived plans `docs/archive/plans/02*-INVENTORY-*.md`,
adapted to the current rules (no `company_id`, lookup tables instead of CHECK type lists, GL posted inline through the
Phase 7 `PostingService`). Decisions are listed in `docs/phases/PHASE-08-REPORT.md`.

## Where things are
| Area | File |
|---|---|
| Valuation core (`postCoreMovement`, re-exported as `postMovement`) | `src/modules/inventory/stock/posting.ts` |
| `StockService` — sorted locking, slices, batches/FEFO, serials, QI stock, reservations, backdate guard, freeze, equality assertion | `src/modules/inventory/stock/stock-service.ts` |
| Stock → GL journal + equality check, cancel = reversal dated the cancel date | `src/modules/inventory/stock/gl.ts` |
| Vouchers with lines (service / repository / legacy adapter) | `src/modules/inventory/vouchers/` |
| Batches, serials, bins | `src/modules/inventory/masters-service.ts` |
| Reservations + holds | `src/modules/inventory/reservations-service.ts` |
| Counts: cycle, physical (freeze), weekly Powder Stock Monitoring Sheet | `src/modules/inventory/count-service.ts` |
| Reorder maths (pure) / reports (ageing, expiry, valuation, GL compare, integrity) | `reorder-calc.ts`, `reports-service.ts` |
| Barcode / GS1 scan | `scan-service.ts` |
| Pre-flight, GL cut-over, daily job | `ops-service.ts` |
| Routes | `routes.ts` + `routes-{stock,masters,counts,reports}.ts` → `/api/v1/inventory/...` |

## Stock rules in one place
* Stock moves only through `StockService.postMovement` (one ledger row per batch/bin slice). Posted rows are never edited;
  a cancel writes REVERSAL rows (stock) and a reversing journal (GL), both dated the cancel date.
* Stock status per slice: `UNRESTRICTED`, `QUALITY_INSPECTION`, `BLOCKED`. Only UNRESTRICTED stock can be issued.
  `StockService.changeStatus` moves quantity between statuses (the Phase 12 Usage Decision calls it).
* `available = unrestricted − reserved − held`. An issue naming a reservation consumes it.
* A transfer dispatches into the unit's transit warehouse (`STOCK_IN_TRANSIT`), receive moves it on. Different GSTINs are
  refused (E-24) with the exact owner message.
* Backdated posting (before the last movement of the item+warehouse) needs `approve` (D-20). A warehouse frozen by a physical
  count refuses everything except that count's own reconciliation.

## Commands
```
npm run db:reset:test                # test DB
npm run inventory:preflight          # pre-flight + integrity + stock-vs-books (read-only)
npm run job:inventory                # run the daily job once (also scheduled in pg-boss 02:00 IST)
psql "$DATABASE_URL" -f prisma/verify/phase08-verify.sql   # verification queries, all must be empty
```
Migration D (drops the old single-item columns) is a draft in `prisma/pending/` and is **not applied** until the owner approves.
