# Plans for the builder model — how to use this folder

**Owner's workflow:** the architect (strong model) writes plans. The builder (Haiku) writes code, one ticket at a time. The architect reviews every ticket and returns either `ACCEPTED` or a numbered `FIX LIST`. Nothing is committed or deployed by the builder.

## Files, in reading order

| # | File | Read when |
|---|---|---|
| 00 | `00-BUILDER-RULES.md` | **Every session, first.** The rules, the frozen UI, safety, commands, the report format |
| D | `DECISIONS.md` | **Binding rulings** that override any plan text (no `company_id`, hand-written migrations, shared engine kit, ownership). Read right after the rules |
| 01 | `01-SHARED-FOUNDATION.md` | Before any ticket: shared tables, service interfaces, ownership, order |
| 02 | `02-INVENTORY-WMS.md` | Inventory (14 pages) + Warehouse/WMS (13 pages) |
| 03 | `03-SCM-PROCUREMENT.md` | Procurement / SCM (11 pages) |
| 04 | `04-SALES-CRM.md` | CRM (8 pages) + Sales (10 pages) |
| 05 | `05-FINANCE-TAX.md` | Finance & Accounts (19 pages) + Indian Taxation (10 pages) |
| 07 | `07-ENGINE-KIT.md` | The shared page-engine extensions (panels, line editors, commands). **Built first**, before any module ticket |
| 06 | `06-QUALITY-QMS.md` | Quality / QMS (10 pages), built from the client's real inspection, rejection, calibration and 8D sheets (`doc from clint/`, confidential, git-ignored) |
| P | `PROMPTS.md` | The exact prompts to paste: start a ticket, fix list, resume after a break |

## Build order
0. `07` Engine kit → 1. `02` Inventory → 2. `03` SCM → 3. `04` Sales/CRM → 4. `05` Finance & Tax → 5. `06` Quality (its GRN hooks need 03; its stock hold needs 02). Within a plan, tickets are numbered in dependency order; never skip ahead.

## The daily loop (what you do)
1. Open a **new** Haiku session.
2. Paste the **Start prompt** from `PROMPTS.md` with the ticket id filled in (e.g. `T-INV-07`).
3. When Haiku prints its **Builder Report**, paste the report (and the diff if asked) to the architect with the **Review prompt**.
4. The architect answers `ACCEPTED` or `FIX LIST`. For a fix list, open the same or a new Haiku session and paste the **Fix prompt**.
5. After `ACCEPTED`, tell Haiku nothing more; start the next ticket in a fresh session.

## Why this works
* Each ticket is small (≤ ~12 files) so a small model keeps all of it in its head.
* The plans contain the **exact** names, columns, formulas and examples, so Haiku never designs.
* The UI is frozen by the registry and by tests, so Haiku cannot "improve" it.
* Every ticket ends with tests and a report, so the reviewer sees facts, not claims.
