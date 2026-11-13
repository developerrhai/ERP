# PHASE 06B — Format & Settings engine (client requirement, added 2026-11-06)
(Read ERRATA.md first. Source: the client's "Master SRS — core architectural directive".
Runs after Phase 6 and before Phase 7. Does not renumber any phase.)

## 1. Goal & why
The client states, as strict compliance: **no hard-coded calculation formulas, margins, process
costs or document layouts.** Everything that a department changes from time to time is read from
configuration or from an uploaded Excel file. When a rule changes in a Settings panel, every screen
and print format that uses it updates at once, with no developer.
This phase builds that mechanism once, so Phases 7–13 and 19 use it instead of writing formats in code.

## 2. Pages in scope
| Page | Screen |
|---|---|
| "Settings" panel on every module page (a tab or button) | Formats, rules, calculation parameters of THIS page. Visible to all with "view"; editable only by the **Department Head of the page's owner department** (and Administrator). |
| admin-formats (new, Administration) | List of all formats and rule sets, versions, who changed what. |

## 3. Business rules
1. **Format** = a versioned definition of a document layout: header fields, line columns, totals, print
   layout, validations. Stored as data (JSON schema), one active version per (page, optional customer, optional unit).
2. **Customer-wise formats:** a quotation or inspection report can have a format per customer. When the
   operator picks or changes the customer, the form re-renders with that customer's format.
3. **Rule sets** hold calculation parameters (margins, process-cost rates, tolerances, norms). Formulas are
   expressions over named inputs, evaluated by a safe expression evaluator (no `eval`), with Decimal maths.
4. **Excel as a source:** an uploaded Excel file can define a format or a rate table. The upload is
   parsed into the same data structures; the original file is kept as evidence.
5. **Dynamic cascade:** publishing a new version updates every list, form and print that reads it.
   Old documents keep the version they were created with (print reproduces the original).
6. **Who may edit:** the Department Head of the owner department (module_controls.owner_department)
   and Administrator. Every change needs a reason, creates a new version and is audited
   (FORMAT_PUBLISHED, RULE_SET_PUBLISHED). Publishing may require approval through the Phase 5 engine
   (configurable per page, default ON for money-affecting rule sets).
7. A format change never rewrites posted or approved documents (R-09).

## 4. Database design (sketch; final SQL written at build time)
~~~
format_definitions(id, page_id, kind PRINT|FORM|REPORT, customer_id null, unit_id null,
  version, status DRAFT|ACTIVE|RETIRED, schema jsonb, source_file_id null, audit cols,
  UNIQUE (page_id, kind, customer_id, unit_id, version))   -- one ACTIVE per key (partial unique)
rule_sets(id, page_id, code, version, status, definition jsonb, audit cols)
rule_set_inputs / rule_set_outputs (named, typed, Decimal) — or inside definition
settings_changes(id, target_type, target_id, version, changed_by, reason, before jsonb, after jsonb, at)  -- append-only
~~~
Documents store `format_version_id` and `rule_set_version_id` they were created with.

## 5. Services
- FormatService.resolve(pageId, kind, {customerId, unitId}) → the active definition.
- RuleEngine.evaluate(ruleSetVersionId, inputs) → Decimal results; deterministic; no network, no I/O.
- ExcelFormatImporter.parse(file) → draft format / rate table with a validation report (nothing is saved until the head publishes).
- The Phase 4 print registry and the engine kit read formats from FormatService.

## 6. API (/api/v1)
GET/PUT /pages/:p/settings/formats, /pages/:p/settings/rules; POST …/publish; POST …/import (Excel);
GET /formats, /formats/:id/versions. All writes: If-Match + Idempotency-Key + permission
`controls` on the page AND department-head check.

## 7. UI
Settings button on every module page; a simple editor (fields, columns, rate tables) with a live preview;
"Publish new version" with a reason; version history with Restore-as-new-version. Plain English errors.
Non-heads see the settings read-only with the tooltip "Only the Department Head can change this".

## 8. Exact messages (to be fixed at build time, same style as Phase 5 §8)
FORMAT_NOT_ALLOWED 403 "Only the Department Head of {department} can change these settings."
FORMULA_INVALID 422 "The formula for {name} is not valid: {reason}."
FORMAT_IN_USE 409 "This format is used by {n} open documents. Publish a new version instead of editing."

## 9. Audit
FORMAT_DRAFTED, FORMAT_PUBLISHED, FORMAT_RETIRED, RULE_SET_PUBLISHED, FORMAT_IMPORTED.

## 10. Tests
Dynamic cascade (change a rate → quotation total changes, old document unchanged); customer switch re-renders
the form; only the Department Head can publish (others 403); formula safety (no code execution);
Excel import report; versions are append-only; 3 clean runs.

## 11. Acceptance checks
- [ ] A rate or margin is changed in Settings and the next quotation uses it; no code change.
- [ ] Changing the customer on a quotation switches to that customer's format.
- [ ] Only the owner department's Head (and Administrator) can publish; every publish is audited.
- [ ] A grep for margin / process-cost constants in services finds 0.

## 12. Out of scope
Visual drag-and-drop report designer (Phase 19 Report Builder); scripting beyond the expression language;
changing statutory values (they stay in the Phase 3/6 statutory tables, R-11).

## 13. Open questions for the owner (the builder must ask, never assume)
1. Which department heads own which pages (confirm module_controls.owner_department).
2. Should publishing a money-affecting rule set need approval (default yes)?
3. Which client Excel files are the first to import as formats (quotation, inspection forms)?
