# 04a — Sales & CRM: the frozen UI, page by page (section 2 of 04-SALES-CRM.md)

Part of `04-SALES-CRM.md` (index). Read `00-BUILDER-RULES.md` and `01-SHARED-FOUNDATION.md` first. Prefix for rules and tickets: **SAL**. Business rules `BR-SAL-nn` are in `04c`, tables in `04b`, tickets `T-SAL-nn` in `04d`.

## 2. The frozen UI, page by page

### 2.0 Conventions used by every page below

1. **Everything frozen comes from the registry and `apps/api/tests/fixtures/field-types.json`.** Page ids, titles, the 6 profile tabs (names and order), field labels, order and field types are never changed. The field list of each page below is copied from the fixture; the `key` column is the camelCase key used in the record's `data` object (given here, never derive it yourself). `[ADD]` marks anything beyond the prototype; added fields are appended AFTER the frozen ones and added tabs/buttons never replace frozen ones.
2. **All 18 pages become TYPED pages** (`kind: 'typed'`, added to `TYPED_PAGES` in `apps/api/src/engine/kinds.ts`; `crm-pipeline` is removed from `CUSTOM_PAGES`). They are served by `GenericModulePage` using the same API shapes as Inventory (`GET /pages/:pageId/schema`, `GET|POST /pages/:pageId/records`, `GET|PATCH|DELETE /pages/:pageId/records/:id`, `POST …/records/:id/actions/:action`, `GET …/export.xlsx`, `GET /pages/:pageId/audit`). Row DTO = `TypedRecordDto` (`id, code, status, unitId, fyId, department, data, version, amount, createdAt, createdBy, updatedAt, deletedAt, refs`). `amount` = the document's money total (see each page).
3. **Universal 16-tab strip** (already built, do not touch): `Module Dashboard`, the 6 profile tabs, `Analytics & Graphs`, `AI Decision Center`, `Automation Studio`, `Data Quality`, `Activity Timeline`, `Documents`, `Approvals`, `Reports`, `Audit Trail`. Only the 6 profile tabs and the Module Dashboard get new behaviour here. The other 8 keep their existing behaviour (honest "later phase" notice or existing live tab).
4. **Register tab** = the first profile tab whose label matches `/register|list|directory|master|queue|log/i`, otherwise the first tab (existing `registerTabName`). Per page it is named below. The register shows the frozen fields as columns (the first 11 frozen fields in order + `Status`, plan 03 C3; the Inventory `define()` cut at 12 is overridden via explicit `listColumns`), search, status filter, page size 10/20/25, sortable headers, row buttons View / Edit / Delete + page actions, bulk Export/Delete Selected. **Header buttons** stay `Excel`, `Print`, `＋ Add` (existing); page actions appear in the record bar and the row.
5. **Panels (the real content of the profile tabs).** Plan 03 (`03a` C6) defined the mechanism and this plan **reuses it**: every profile tab that is not the register is a **panel** fetched with `GET /pages/:pageId/records/:id/panels/:panelKey` (scope **R**, needs `?rec=<id>`) or `GET /pages/:pageId/panels/:panelKey` (scope **P**, unit + FY aggregates), where `panelKey` = tab label lower-cased with non-alphanumerics replaced by `-`. The JSON vocabulary and the web component `PanelView` are those of plan 03 C6, **extended** by T-SAL-15 with section types `funnel` (`{bars:[{label,count,value}]}`), `bars` (`{rows:[{label,value,max,format}]}`), `timeline` (`{events:[{title,sub,body,link?}]}`), `calendar` (`{month:'YYYY-MM',days:[{date,items:[{label,id}]}]}`) and `board` (`{lanes:[{key,label,count,sum?,cards:[{id,title,sub,tone?}]}]}`), drawn with the prototype `v9-*` classes (rules of `reference/index.html` lines 44-65 copied verbatim into `apps/web/src/styles/panels.css` if plan 03 has not done so). In this file a panel is written `[ws:<key>]`: `<key>` is the name of the server builder function (catalogued with scope R/P in `04c` §7.9). The prototype renderer type from `docs/REGISTRY.csv` is named in brackets so the look matches (v9Pipeline = funnel + KPI + conversion rows; v9Communication = timeline + add-activity form; v9Allocation = demand / available / allocated / short table; v9Logistics = stepper + queue; v9Payment = receipt / allocation table; v9Finance = simulator with Base / Discount / Tax inputs; v9Ageing = bucket bars; v9Approval = level stepper; v9Workflow = lane board; v9Exceptions = severity table; v9History = timeline; v9Validation = rule results table; v9TaxWorkspace = statutory stepper; v9Quality = parameter table; v9Master = master table; v9Mapping = source-to-target mapping; v9Rules = rule list with enable toggle; v9Calendar = month grid; v9Operations = detail grid + mini cards; analyticsTab = KPIs + 2 charts). **No synthetic or hash-generated numbers anywhere** (defects 23 and 28 of PLAN.md section 2.2): every figure comes from the database; an empty database shows zeros and the exact empty-state texts of plan 03 C7.
6. **Line editor tabs.** Documents with lines follow plan 03 convention C4: `GET /pages/:pageId/records/:id` returns `data.lines`; create and PATCH (with `If-Match`) accept `data.lines` (the whole array replaces the Draft lines; the server assigns `lineNo` and recomputes every total). The tabs `Item & Tax Lines` (quotations) and `Order Items` (orders) show the panel section `{type:'lines', lineKind:'qtn'|'so'}` = the web `LinesEditor` (T-SAL-20 adds the line kinds `qtn, so, plan, dsp, inv, cn, ret` to the component of plan 03), looking like the prototype `v9LineItems` (columns #, Item / Service, Description, Qty, Rate, Disc %, Tax %, Net, Action + Document Total). Dispatch, invoice, credit-note and return lines are shown read-only after creation from the previous document.
7. **Required marks** follow the fixture (`*`). Dates other than the document date are optional (builder rule 5). `Status` is the workflow status: read-only in forms, changed by actions only. Totals and derived fields are `readOnly`.
8. **Money** shown as ₹ en-IN (lakh/crore grouping); stored `numeric(18,2)`; qty `numeric(18,3)`; rates `numeric(18,6)`; percent `numeric(7,4)`. API JSON numbers are JS numbers produced with `num()` (money.ts) but **all arithmetic uses `Decimal`**.
9. **Lookups** (new `GET /lookups/<kind>`, 04c §7.8): `customers, leads, lead-customers, related-records, opportunities, quotations, sales-orders, invoices, dispatches, price-lists, lead-sources, loss-reasons, competitors, users`; existing `items`, `warehouses`. A `ref` field with no lookup is free text (existing behaviour).
10. **Empty states** (register): "No <things> yet. Click ＋ Add to create the first one." (the existing text). Workspace sections: "Nothing to show for the selected period." (never demo rows).
11. **Number format** of codes: `<PFX>/<UNIT>/<FY>/<0001>` e.g. `SO/TAL/26-27/0001` (unit code TAL / SAW / VAR, `FY = fy.code.slice(2)` as plan 03 BR-SCM-31), gap-free per (page key, unit, FY) from `number_series`. Masters with user-entered codes use `^[A-Z0-9/_-]{2,30}$`.
12. **Data scope** OWN / DEPARTMENT / ALL applies to all document tables (exact rule `BR-SAL-60`). The module is visible also to Finance, Warehouse, Service departments by the existing department-family grants (read), never by code.

Common record actions (all typed pages unless a page says otherwise): `View` (drawer), `Edit` (only in an editable status), `Delete` (soft delete + Undo toast, Draft only, 409 `RECORD_LOCKED` otherwise), `Restore`.

---

## CRM (8 pages)

### 2.1 `crm-leads` — Lead Management (table `leads`)

**Purpose line (registry):** "Manage prospect engagement, qualification, relationship history and conversion performance." (same for all 8 CRM pages). **Register tab:** `Lead Register`. **Prefix:** `LEA`. **Amount:** `expected_value`.

| Tab (registry name) | Renderer | What it shows / does, from which data |
|---|---|---|
| Lead Register | registerTab | The register of `leads` (frozen columns). Row actions below. |
| Qualification Desk | v9Pipeline | `[ws:crm.lead.qualification]` Funnel New → Contacted → Qualified → Converted (counts of leads in context, from `leads.status`); table "Awaiting qualification" = Contacted leads with score, missing gates (BR-SAL-70) and buttons Qualify / Disqualify (they call the row actions). |
| Communication Timeline | v9Communication | `[ws:crm.timeline.lead]` last 50 `crm_timeline_entries` with `subject_type='LEAD'` (call, email, WhatsApp, meeting, note, stage change); right panel "Add Activity" (type, text) posts `POST /api/v1/crm/timeline`. |
| Follow-up Queue | v9Communication | `[ws:crm.followups.lead]` open `crm_followups` whose subject is a lead, overdue first, with Done / Reschedule buttons (the actions of `crm-followups`). |
| Lead Scoring | v9Pipeline | `[ws:crm.lead.scoring]` histogram of `qualification_score` in bands 0-24 / 25-49 / 50-74 / 75-100, the rule table with weights (BR-SAL-71) and the top 20 leads by score. |
| Conversion Analytics | v9Pipeline | `[ws:crm.lead.conversion]` leads created vs converted per month (current FY), conversion % by source, average days lead to conversion (BR-SAL-80). |

**Fields (frozen order, then `[ADD]`):**

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Lead No | leadNo | code | yes | auto `LEA/<UNIT>/<FY>/0001`, read-only |
| 2 | Lead Name | leadName | text | yes | 2-150 chars, the contact person or lead title |
| 3 | Company | company | ref | no | free text (no lookup), max 150; the prospect's company name |
| 4 | Mobile | mobile | phone | no | `^[6-9]\d{9}$` (stored as 10 digits; `+91`, spaces and dashes stripped) |
| 5 | Email | email | email | no | lower-cased |
| 6 | Source | source | enum | no | options = the active `lead_sources.name` (lookup `lead-sources`); stored as `source_id` |
| 7 | Campaign | campaign | text | no | max 100 |
| 8 | Owner | owner | ref | no | lookup `users`; default = creator; stored `owner_user_id` |
| 9 | Stage | stage | enum | no | New, Contacted, Nurture, Qualified, Unqualified (default New) |
| 10 | Qualification Score | qualificationScore | pct | no | **read-only, computed** (BR-SAL-71), 0-100 |
| 11 | Expected Value | expectedValue | money | no | ≥ 0 |
| 12 | Next Follow-up | nextFollowUp | date | no | read-only mirror of the earliest open follow-up of this lead (BR-SAL-82) |
| 13 | Consent Status | consentStatus | enum | no | Not Recorded (default), Granted, Withdrawn, Expired (BR-SAL-85) |
| 14 | Status | status | status | no | New, Contacted, Qualified, Converted, Disqualified |
| 15 | `[ADD]` Requirement | requirement | longtext | no | what the prospect needs |
| 16 | `[ADD]` Designation | designation | text | no | contact designation |
| 17 | `[ADD]` Is Decision Maker | isDecisionMaker | bool | no | feeds the score |
| 18 | `[ADD]` City | city | text | no | |
| 19 | `[ADD]` State | stateCode | enum | no | GST state list (04c §6.3), stored as 2-digit code |
| 20 | `[ADD]` GSTIN | gstin | gstin | no | optional; used to detect an existing customer |
| 21 | `[ADD]` Expected Close | expectedClose | date | no | feeds score and the opportunity |
| 22 | `[ADD]` Disqualify Reason | disqualifyReason | enum | no | Budget, No Need, Competitor, Not Reachable, Duplicate, Other (required by `disqualify`) |
| 23 | `[ADD]` Consent Date | consentDate | date | no | set with consent |
| 24 | `[ADD]` Consent Purpose | consentPurpose | text | no | e.g. "Product updates by WhatsApp" |

**Statuses:** New → Contacted → Qualified → Converted | Disqualified. Editable in New, Contacted, Qualified. Converted and Disqualified are locked.
**Row actions** (key, label, from, effect): `contact` (New → Contacted, sets Stage Contacted), `qualify` (Contacted → Qualified; gates BR-SAL-70), `disqualify` (New/Contacted/Qualified → Disqualified; confirm "Disqualify {code}?", reason required), `convert` (Qualified → Converted: creates or links the customer and creates an opportunity, BR-SAL-72), `reopen` (Disqualified → Contacted, needs `approve`), `record-consent` and `withdraw-consent` (BR-SAL-85; allowed in any status, also locked rows, because withdrawing consent must always work).
**Filters:** Status, Stage, Source (lookup lead-sources), Owner (lookup users), "Score at least" (number), "Overdue follow-up" (bool), "Consent granted" (bool). **Totals:** Leads (count), Expected Value (sum), Average Score.
**Empty state:** "No leads yet. Click ＋ Add to capture the first lead." A **duplicate warning** appears on create (BR-SAL-73): the modal lists the matches.

### 2.2 `crm-opportunities` — Opportunity Management (table `opportunities`)

**Register tab:** `Opportunity Register`. **Prefix** `OPP`. **Amount:** `expected_value`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Opportunity Register | registerTab | register of `opportunities`. |
| Stage Progress | v9Pipeline | `[ws:crm.opp.stage]` funnel New → Qualified → Proposal → Negotiation → Won with count and ₹ value per stage, average days spent in each stage (from `opportunity_stage_history`), number of stage-gate failures (audit). |
| Probability & Forecast | v9Pipeline | `[ws:crm.opp.forecast]` weighted pipeline = Σ(expected_value × probability/100) per expected-close month of the FY, forecast categories Pipeline < 50, Best Case 50-74, Commit 75-99 (BR-SAL-81), calibration rows (planned probability vs actual win rate by stage). |
| Proposal Activity | v9History | `[ws:crm.opp.proposals]` timeline of quotations linked to opportunities (created, sent, accepted, expired, lost), newest first, with links. |
| Competitor Tracking | v9Allocation | `[ws:crm.opp.competitors]` table competitor × deals, won, lost, won value, lost value, top loss reason (from `crm_competitors` and `opportunities.competitor_id`). |
| Win Loss Analysis | v9Pipeline | `[ws:crm.opp.winloss]` win rate (BR-SAL-80), lost-reason bars, average cycle days, win rate by source and by salesperson. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Opportunity No | opportunityNo | code | yes | auto `OPP/…` |
| 2 | Customer | customer | ref | yes | lookup `customers` (a prospect is a customer with `customer_stage='PROSPECT'`) |
| 3 | Opportunity Name | opportunityName | text | yes | 2-150 |
| 4 | Stage | stage | enum | no | New, Qualified, Proposal, Negotiation, Won, Lost (default New); **changed only by the stage endpoint/action** (read-only in the form) |
| 5 | Probability % | probabilityPct | pct | no | default from the stage (10/25/50/75/100/0); user may override except Won = 100 and Lost = 0 (BR-SAL-81) |
| 6 | Expected Value | expectedValue | money | no | ≥ 0 |
| 7 | Expected Close | expectedClose | date | no | optional (required to enter Proposal) |
| 8 | Primary Contact | primaryContact | ref | no | free text name (the customer's contacts are suggested) |
| 9 | Salesperson | salesperson | ref | no | lookup `users`, default creator |
| 10 | Competitor | competitor | text | no | free text; if it equals a `crm_competitors.name` (case-insensitive) the id is linked |
| 11 | Next Action | nextAction | longtext | no | |
| 12 | Status | status | status | no | Open, Won, Lost, On Hold |
| 13 | `[ADD]` Priority | priority | enum | no | Low, Medium (default), High |
| 14 | `[ADD]` Source Lead | sourceLead | ref | no | read-only, set by conversion |
| 15 | `[ADD]` Loss Reason | lossReason | enum | no | lookup `loss-reasons`; required on Lost |
| 16 | `[ADD]` Next Action Date | nextActionDate | date | no | |
| 17 | `[ADD]` Forecast Category | forecastCategory | enum | no | Pipeline, Best Case, Commit, Closed (read-only, BR-SAL-81) |

**Statuses:** Open (stage New..Negotiation) → Won | Lost; On Hold (manual) → Open. Won/Lost are locked; `reopen` needs `approve`.
**Actions:** `move-stage` (body `{stage, reason?, lossReasonId?}`; same engine as the Kanban drag; BR-SAL-74), `hold` / `resume`, `create-quotation` (Draft quotation for the customer, linked; BR-SAL-75), `reopen`.
**Filters:** Stage, Status, Salesperson, Priority, Expected close (this month / next month / overdue), "Value at least". **Totals:** Open count, Pipeline Value (sum of open), Weighted Value.
**Delete:** 409 `IN_USE` when quotations are linked (mark Lost instead).

### 2.3 `crm-pipeline` — Sales Pipeline / Kanban (view over `opportunities`; no own table)

Prototype: `kanbanPage()` shows only the head "Sales Pipeline / Kanban", the sub text "Visual workflow board." and 5 lanes (`.workflow` > `.lane` > `.lane-card`): New, Qualified, Proposal, Negotiation, Won. **Kept exactly.** The registry's 6 profile tabs are added **under the page head as the normal tab strip** (frozen names); the board is the content of the first tab. A 6th lane "Lost" `[ADD]` is hidden unless the toggle "Show Lost" is on. **Register tab:** the first tab (`Sales Pipeline / Kanban Workspace`), which hosts the board; an `[ADD]` toggle "Board | List" switches to the register table with the frozen columns. The placeholder fields stay as the register columns; the real data is the opportunity:

| # | Label (frozen) | key | type | req | Mapped from the opportunity |
|---|---|---|---|---|---|
| 1 | Record No | recordNo | code | yes | `opportunities.code` |
| 2 | Name | name | text | yes | opportunity name |
| 3 | Customer Company | customerCompany | ref | yes | customer (lookup `customers`) |
| 4 | Owner | owner | ref | no | salesperson |
| 5 | Stage | stage | enum | no | stage (6 options) |
| 6 | Priority | priority | enum | no | Low, Medium, High |
| 7 | Next Action | nextAction | longtext | no | |
| 8 | Expected Value | expectedValue | money | no | |
| 9 | Due Date | dueDate | date | no | `expected_close` |
| 10 | Status | status | status | no | Open, Won, Lost, On Hold |

Create, edit, delete and actions on this page call the same `OpportunityService` as `crm-opportunities`; Add creates an opportunity. **Card** (`.lane-card`): bold name, small line "Customer · ₹ value", small line "Owner: <name> · <days in stage>d", a red dot when stale or overdue (BR-SAL-76). Lane header: stage name, count and ₹ sum `[ADD]`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Sales Pipeline / Kanban Workspace | kanban | **The board.** `[ws:crm.pipeline.board]` = `GET /api/v1/crm/pipeline/board?owner=&priority=&q=` returns lanes with cards (max 50 per lane, "Load more"). **Dragging a card to another lane** (HTML5 drag and drop; keyboard alternative: a "Move to…" select on each card) calls `PATCH /api/v1/crm/opportunities/:id/stage` with `If-Match`. On 422 (stage gate) the card snaps back and a toast shows the message; dropping on Lost opens a modal asking the loss reason; Won needs the gate BR-SAL-74. Filter chips: My deals / All, Priority. |
| Sales Pipeline Kanban Details | v9Operations | `[ws:crm.pipeline.details]` the selected card's detail grid (all frozen fields + customer, contact, linked quotations, last 5 timeline entries) and 8 mini cards of the most recently moved deals. |
| Sales Pipeline Kanban Workflow | v9Workflow | `[ws:crm.pipeline.workflow]` the stage-gate table (stage, default probability, required fields, forecast category, SLA days) from `crm_pipeline_stages` and the stage history of the last 20 moves with who and when. |
| Sales Pipeline Kanban Exceptions | v9Exceptions | `[ws:crm.pipeline.exceptions]` deals that are stale (no timeline entry for `stale_days`, default 14), past expected close, without next action, or in Negotiation without a quotation; severity Critical / Review; link to the deal. |
| Sales Pipeline Kanban Performance | analyticsTab | `[ws:crm.pipeline.performance]` per salesperson: open value, weighted value, won MTD / FY, win rate, average cycle days; two charts (pipeline by stage, won by month). |
| Sales Pipeline Kanban Controls | v9Rules | `[ws:crm.pipeline.controls]` editable (needs `controls`): stages with default probability, forecast category, required fields; settings `stale_days`, "allow skipping stages"; saves with `PATCH /api/v1/crm/config`. |

**Statuses, actions, filters, totals:** as `crm-opportunities` (same data). `move-stage` is reachable by drag and by the record bar. **Empty state:** each lane shows "No deals".

### 2.4 `crm-followups` — Follow-ups & Tasks (table `crm_followups`)

**Register tab:** `Outcome Log` (the first tab matching the register rule). **Prefix** `FUP`. **Amount:** null.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Follow-up Planner | v9Communication | `[ws:crm.fup.planner]` timeline of the next 14 days of Planned follow-ups grouped by day with owner and channel; the "Add Activity" form creates a follow-up. |
| Due Today | v9Payment | `[ws:crm.fup.today]` table of Planned follow-ups with `due_date = today`: reference, subject, purpose, time, buttons `Done` (outcome modal) and `Reschedule`. |
| Overdue Actions | v9Ageing | `[ws:crm.fup.overdue]` buckets 1-3 / 4-7 / 8-14 / over 14 days overdue (bars) + table, button `Escalate to manager` (writes a timeline entry and a notification, BR-SAL-82). |
| Reminder Automation | v9Communication | `[ws:crm.fup.reminders]` the reminder rules in force: remind the owner N hours before (config `followup_reminder_hours`, default 2), escalate after N overdue days (default 3); history of reminders from `crm_timeline_entries` type `REMINDER`. Editable with `controls`. |
| Outcome Log | registerTab | register of follow-ups (frozen columns). |
| Completion Analytics | analyticsTab | `[ws:crm.fup.completion]` done / missed / cancelled per owner and per week, on-time completion % (BR-SAL-82), average delay days. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Follow-up No | followUpNo | code | yes | auto |
| 2 | Lead Customer | leadCustomer | ref | yes | lookup `lead-customers`; value `LEAD:<uuid>` or `CUSTOMER:<uuid>` |
| 3 | Related Record | relatedRecord | ref | no | lookup `related-records` (opportunity, quotation, order, invoice); value `<TYPE>:<uuid>` |
| 4 | Owner | owner | ref | no | `users`, default creator |
| 5 | Due Date | dueDate | date | no | default today; not before today on create (422 `DATE_IN_PAST`) |
| 6 | Due Time | dueTime | datetime | no | stored as `HH:MM` text (column `due_time`); the UI shows a time picker; type `datetime` is frozen |
| 7 | Channel | channel | enum | no | Call, Email, WhatsApp, SMS, Visit, Meeting |
| 8 | Purpose | purpose | longtext | no | |
| 9 | Outcome | outcome | longtext | no | required by `done` |
| 10 | Next Follow-up | nextFollowUp | date | no | if set when marking Done a new follow-up is created (BR-SAL-82) |
| 11 | Priority | priority | enum | no | Low, Medium, High |
| 12 | Status | status | status | no | Planned, Done, Missed, Cancelled |
| 13 | `[ADD]` Completed At | completedAt | datetime | no | read-only |

**Actions:** `done` (body `{outcome, nextFollowUp?}`), `reschedule` (body `{dueDate, dueTime?}`), `cancel`, `mark-missed` (also set by the nightly job when Planned and `due_date < today - 1`). A marketing channel (WhatsApp / SMS / Email) on a subject without valid consent shows the chip "No marketing consent"; `done` stays allowed (it only records a conversation; sending is the Communication module's job, BR-SAL-85).
**Filters:** Status, Owner, Channel, Priority, Due (today / overdue / next 7 days). **Totals:** Planned, Overdue, Done this week.

### 2.5 `crm-meetings` — Meetings & Calls (table `crm_meetings`)

**Register tab:** `Call Log`. **Prefix** `MTG`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Meeting Calendar | v9Calendar | `[ws:crm.mtg.calendar]` month grid (`.calendar` / `.day`), each day lists the meetings (subject chip), click opens the record; month switch; "Add Schedule Item" creates a meeting. |
| Call Log | registerTab | register of meetings and calls. |
| Agenda & Notes | v9Communication | `[ws:crm.mtg.notes]` timeline of the last 30 meetings with agenda and outcome; "Add Activity" appends a note to the selected meeting. |
| Participants | v9Communication | `[ws:crm.mtg.participants]` participants per meeting (name, role, attended yes/no); button to add one. |
| Action Items | v9Workflow | `[ws:crm.mtg.actions]` lane board Planned / Done / Missed of the follow-ups created from meetings (`crm_followups.source_meeting_id`). |
| Engagement Analytics | analyticsTab | `[ws:crm.mtg.analytics]` meetings and calls per week and per owner, average duration, share by mode, customers not met in 90 days. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Meeting No | meetingNo | code | yes | auto |
| 2 | Subject | subject | longtext | no | frozen type longtext; max 200 enforced |
| 3 | Customer Lead | customerLead | ref | yes | lookup `lead-customers` |
| 4 | Start Date | startDate | date | yes | |
| 5 | Start Time | startTime | datetime | no | `HH:MM` |
| 6 | Duration | duration | qty | no | minutes, ≥ 0 (shown "45 min") |
| 7 | Location Mode | locationMode | enum | no | Office, Customer Site, Video Call, Phone Call |
| 8 | Organizer | organizer | ref | no | `users` |
| 9 | Participants | participants | qty | no | **read-only count** of the participant list |
| 10 | Agenda | agenda | longtext | no | |
| 11 | Outcome | outcome | longtext | no | |
| 12 | Status | status | status | no | Planned, Done, Missed, Cancelled |
| 13 | `[ADD]` Kind | kind | enum | no | Meeting (default), Call; Phone Call mode implies Call |
| 14 | `[ADD]` Participant List | participantList | longtext | no | one per line "Name | Role" (parsed into `participants jsonb`) |

**Actions:** `done` (outcome required; optional `{createFollowUp:{dueDate,purpose}}`), `reschedule`, `cancel`, `mark-missed`. **Filters:** Status, Organizer, Kind, Month. **Totals:** This week, Done, Average duration.

### 2.6 `crm-customer360` — Customer 360° (view over `parties` where `is_customer`)

Placeholder profile fields stay as register columns; the real UI is the Customer 360 profile. **Register tab:** the first tab (`Customer 360° Workspace`), which hosts a customer picker + profile; an `[ADD]` toggle "Profile | List" shows the register table of customers. **Code:** customer code `CUS/00001` (foundation: company-wide, `unit_id` null) or user-entered.

| # | Label (frozen) | key | type | req | Mapped from the customer |
|---|---|---|---|---|---|
| 1 | Record No | recordNo | code | yes | `parties.code` |
| 2 | Name | name | text | yes | `parties.name` |
| 3 | Customer Company | customerCompany | ref | yes | `legal_name` (free text; defaults to Name) |
| 4 | Owner | owner | ref | no | `sales_person_id` (lookup users) |
| 5 | Stage | stage | enum | no | `customer_stage`: Prospect, New, Active, At Risk, Dormant, Lost (the nightly job computes Active / At Risk / Dormant unless manually fixed, BR-SAL-86) |
| 6 | Priority | priority | enum | no | `customer_tier`: A, B, C (default C; auto-suggested from 12-month revenue, BR-SAL-86) |
| 7 | Next Action | nextAction | longtext | no | read-only mirror of the next open follow-up purpose, else the editable note `next_action_note` |
| 8 | Expected Value | expectedValue | money | no | read-only: Σ open opportunity value of this customer |
| 9 | Due Date | dueDate | date | no | read-only: due date of that next follow-up |
| 10 | Status | status | status | no | Active, Inactive, Blocked (`parties.status`) |

Create here = `PartyService.createCustomer` (duplicate checks on GSTIN / PAN / name, BR-SAL-62). Delete: 409 `IN_USE` if any lead, opportunity, quotation, order, invoice or receipt references the customer; use `deactivate`. Actions: `activate`, `deactivate`, `block` / `unblock` (need `approve`; block writes a credit hold, BR-SAL-52).

| Tab | Renderer | What it shows / does |
|---|---|---|
| Customer 360° Workspace | v9Operations | `[ws:crm.c360.workspace]` customer picker (lookup `customers`), then: profile card (name, code, GSTIN, PAN, state, owner, tier, stage, payment terms, price list, credit limit), 8 KPI cards (orders FY, revenue FY, open order value, receivable outstanding, overdue, credit available, open opportunities, last NPS), the 8 latest documents as mini cards (`.v9-mini-card`) with links. |
| Customer 360° Details | v9Operations | `[ws:crm.c360.details]` detail grid: legal name, type, GST registration type, addresses (billing / shipping / registered), contacts, bank (masked), MSME flag, TDS-receivable settings (BR-SAL-47), customer-specific part numbers (`customer_item_prices`). |
| Customer 360° Workflow | v9Workflow | `[ws:crm.c360.timeline]` the unified timeline of this customer (leads, activities, quotations, orders, deliveries, invoices, receipts, returns, feedback) from `crm_timeline_entries`, filter by type; "Add note". |
| Customer 360° Exceptions | v9Exceptions | `[ws:crm.c360.exceptions]` open problems: overdue invoices, active credit hold, quotations expiring within 7 days, orders past promise date, open complaints, returns awaiting inspection; each with a link. |
| Customer 360° Performance | v9HRWorkspace look (detail grid + mini cards) | `[ws:crm.c360.performance]` revenue by month (FY), margin %, OTIF %, DSO (BR-SAL-84), average discount %, top 10 items, lifetime value. |
| Customer 360° Controls | v9Pipeline look (stage bars) | `[ws:crm.c360.controls]` editable form (needs `edit`): credit limit and credit days (written through the credit profile, BR-SAL-50), price list, payment terms, owner, tier, stage override, block / unblock, marketing consent, TDS settings. |

**Filters:** Stage, Priority (tier), Owner, Status, "Has overdue" (bool), State. **Totals:** Customers, Active, Open pipeline value.

### 2.7 `crm-feedback` — Customer Feedback (table `crm_feedback`)

**Register tab:** `Feedback Inbox` (first tab). **Prefix** `FDB`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Feedback Inbox | v9Communication | the register (frozen columns) is the inbox; unread = Open. |
| CSAT & NPS | analyticsTab | `[ws:crm.fb.nps]` NPS (BR-SAL-87) with promoters / passives / detractors counts, CSAT average, trend by month (2 charts). |
| Issue Categories | v9Exceptions | `[ws:crm.fb.categories]` count and average rating per category and age of the oldest open item. |
| Response Workflow | v9Workflow | `[ws:crm.fb.workflow]` lanes Open / Actioned / Closed with cards; `Move Forward` calls the actions. |
| Improvement Actions | v9Workflow | `[ws:crm.fb.actions]` feedback with a Corrective Action: owner, target date, status; button `Create follow-up` creates a follow-up for the owner. |
| Sentiment Trends | v9Communication | `[ws:crm.fb.trend]` per month average rating and detractor share (bars) + timeline of the latest comments. Sentiment = rating based (≤ 40 negative, 41-70 neutral, > 70 positive); no text AI in v1. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Feedback No | feedbackNo | code | yes | auto |
| 2 | Customer | customer | ref | yes | lookup `customers` |
| 3 | Date | feedbackDate | date | yes | default today, not in the future |
| 4 | Channel | channel | enum | no | Email, Phone, WhatsApp, Visit, Web Form, Survey |
| 5 | Rating | rating | pct | no | CSAT 0-100 (the UI helper offers 1-5 stars = 20-100) |
| 6 | NPS Score | npsScore | pct | no | **0-10 only** (`max: 10`, display suffix "/10"; the type stays `pct` as frozen) |
| 7 | Category | category | enum | no | Quality, Delivery, Pricing, Service, Documentation, Other |
| 8 | Comments | comments | longtext | no | |
| 9 | Owner | owner | ref | no | `users` (default: the customer's salesperson) |
| 10 | Corrective Action | correctiveAction | longtext | no | |
| 11 | Closure Date | closureDate | date | no | set by `close`, ≥ feedback date |
| 12 | Status | status | status | no | Open, Actioned, Closed |
| 13 | `[ADD]` Related Document | relatedDocument | ref | no | lookup `related-records` (invoice / order / dispatch) |

**Actions:** `action` (Open → Actioned; Corrective Action required), `close` (Actioned → Closed; Closure Date = today), `reopen` (needs `approve`). A detractor (NPS ≤ 6 or rating ≤ 40) auto-creates a follow-up for the owner (BR-SAL-87). **Filters:** Status, Category, Channel, Owner, "Detractors only". **Totals:** Open, Average rating, NPS.

### 2.8 `crm-sources` — Lead Sources (table `lead_sources`, master)

**Register tab:** `Source Master`. Master page: codes user-entered, no numbering. **Statuses:** Active, Inactive.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Source Master | v9Master | register of sources. |
| Campaign Mapping | v9Mapping | `[ws:crm.src.campaigns]` table source → campaign → UTM source / medium → lead count; editable mapping of free-text lead Campaign values to a source. |
| UTM Tracking | v9Allocation | `[ws:crm.src.utm]` leads by `utm_source` × `utm_medium` (counts, qualified, won) and the web-form capture URL pattern. |
| Source Cost | v9Finance | `[ws:crm.src.cost]` monthly cost per source, cost per lead, per qualified lead, per won deal (BR-SAL-83); a "what if monthly cost = X" input recomputes live in the browser. |
| Source Quality | v9Quality | `[ws:crm.src.quality]` per source: qualification rate, conversion rate, average score, average days to convert (green / red against thresholds in `sales_config`). |
| ROI Analysis | v9Finance | `[ws:crm.src.roi]` revenue vs cost per source, ROI % = (revenue − cost) / cost (BR-SAL-83). |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Source Code | sourceCode | code | yes | user-entered master code |
| 2 | Source Name | sourceName | text | yes | unique among live sources (case-insensitive) |
| 3 | Channel | channel | enum | no | Website, Referral, Trade Show, Cold Call, IndiaMART, Google Ads, LinkedIn, Email Campaign, Channel Partner, Walk-in, Other |
| 4 | Campaign | campaign | text | no | |
| 5 | UTM Source | utmSource | enum | no | Google, LinkedIn, Facebook, Instagram, Email, WhatsApp, IndiaMART, Direct, Other |
| 6 | UTM Medium | utmMedium | text | no | e.g. cpc, email, referral |
| 7 | Monthly Cost | monthlyCost | money | no | ≥ 0 |
| 8 | Leads | leads | qty | no | **read-only computed** = live leads with this source in the context FY |
| 9 | Qualified | qualified | qty | no | computed = leads with status Qualified or Converted |
| 10 | Won | won | qty | no | computed = converted leads whose opportunity is Won |
| 11 | Revenue | revenue | money | no | computed = Σ taxable value of Posted invoices (FY) of customers converted from these leads |
| 12 | Status | status | status | no | Active, Inactive |

**Actions:** `activate`, `deactivate`. Delete: 409 `IN_USE` once any lead references the source. **Filters:** Status, Channel. **Totals:** Total Cost, Leads, Won.

---

## Sales (10 pages)

Purpose line (registry, all 10): "Control quote-to-cash execution with pricing, stock, delivery, billing and customer credit visibility." Owner department: Sales; Finance, Warehouse and Service read. Header fields of documents (Subtotal … Grand Total) are **read-only server totals** (`TaxService`, BR-SAL-01 to BR-SAL-08); only Freight (and the price list / currency choices) are typed by the user.

### 2.9 `sales-quotations` — Sales Quotations (tables `sales_quotations`, `sales_quotation_lines`, `sales_quotation_revisions`)

**Register tab:** `Quotation Register`. **Prefix** `QTN`. **Amount:** `grand_total`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Quotation Register | registerTab | register of quotations. |
| Item & Tax Lines | v9LineItems | `[lines]` the `LinesEditor` for this quotation (items, qty, rate (auto-filled by the price engine BR-SAL-20), discount %, tax % from the HSN, net, line total) and the document totals box (Subtotal, Discount, Taxable, CGST/SGST/IGST, Freight, Round-off, Grand Total) after every save. |
| Pricing Controls | v9Finance | `[ws:sal.qtn.pricing]` for the selected quotation: per line cost (moving-average valuation rate, else item standard cost), margin %, the floor (price list `margin_floor_pct`, else `sales_config.default_margin_floor_pct`), discount vs the user's authority (BR-SAL-21/22), flag "needs approval"; plus the simulator Base / Discount % / Tax % (browser-only recompute). |
| Terms & Validity | v9Validation | `[ws:sal.qtn.terms]` rule results table: validity date present and ≥ quote date, payment terms set, delivery terms set, place of supply valid, GSTIN present for B2B, lines present, all lines priced > 0; each row Pass / Warning / Fail with the fix; terms text fields editable here (`[ADD]` fields below). |
| Approval & Revision | v9Approval | `[ws:sal.qtn.approval]` stepper Requester → Sales Manager → Final authority (level reached = from `approval_status` and approver), the list of revisions (R0, R1 … with who, when, reason, total) from `sales_quotation_revisions`, buttons Submit / Approve / Reject / Revise (the actions). |
| Conversion Analysis | v9Pipeline | `[ws:sal.qtn.conversion]` funnel Draft → Sent → Accepted → Converted to order (counts and ₹), quote→order conversion % (BR-SAL-88), average days to accept, lost reasons, expiry rate. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Quotation No | quotationNo | code | yes | auto `QTN/<UNIT>/<FY>/0001` |
| 2 | Customer | customer | ref | yes | lookup `customers`; must be Active, not Blocked (422 `CUSTOMER_BLOCKED`) |
| 3 | Quote Date | quoteDate | date | yes | default today, inside the context FY |
| 4 | Valid Till | validTill | date | no | default quote date + `sales_config.quotation_validity_days` (30); ≥ quote date |
| 5 | Price List | priceList | ref | no | lookup `price-lists`; default = the customer's list |
| 6 | Currency | currency | text | no | read-only `INR` in v1 (BR-SAL-09) |
| 7 | Subtotal | subtotal | money | no | read-only: Σ qty × rate |
| 8 | Discount | discount | money | no | read-only: Σ line discounts |
| 9 | Taxable | taxable | money | no | read-only |
| 10 | GST | gst | money | no | read-only: CGST + SGST + IGST + cess |
| 11 | Freight | freight | money | no | editable, ≥ 0 |
| 12 | Grand Total | grandTotal | money | no | read-only, rounded to the rupee |
| 13 | Salesperson | salesperson | ref | no | lookup `users`, default creator |
| 14 | Revision | revision | text | no | read-only `R0`, `R1` … |
| 15 | Status | status | status | no | see below |
| 16 | `[ADD]` Opportunity | opportunity | ref | no | lookup `opportunities` (set by `create-quotation`) |
| 17 | `[ADD]` Place of Supply | placeOfSupply | enum | no | state list; default from the customer's shipping address state (BR-SAL-03) |
| 18 | `[ADD]` Payment Terms | paymentTerms | ref | no | lookup `payment-terms`; default customer's |
| 19 | `[ADD]` Delivery Terms | deliveryTerms | text | no | e.g. "Ex-works Talwade, 2 weeks" |
| 20 | `[ADD]` Warranty | warranty | text | no | |
| 21 | `[ADD]` Terms & Notes | termsNotes | longtext | no | printed on the PDF |
| 22 | `[ADD]` Customer RFQ Ref | customerRfqRef | text | no | |
| 23 | `[ADD]` Approval Status | approvalStatus | enum | no | NA, PENDING, APPROVED, REJECTED (read-only) |
| 24 | `[ADD]` Lost Reason | lostReason | enum | no | lookup `loss-reasons`, set by `mark-lost` |

**Statuses:** Draft → Submitted → Approved → Sent → Accepted | Expired | Lost; side exits Rejected (back to Draft by `revise`) and Cancelled. Editable only in Draft (and Rejected → via `revise`).
**Actions:** `submit` (Draft → Submitted, or straight to Approved when no approval is needed, BR-SAL-22), `approve`, `reject` (reason required; both need `approve` and a different user than the creator), `send` (Approved → Sent), `accept` (Sent → Accepted, optional `{customerRef, acceptedOn}`), `mark-lost` (Sent → Lost, reason), `revise` (Sent / Approved / Rejected / Expired → Draft, revision + 1, snapshot saved, BR-SAL-23), `create-order` (Approved / Sent / Accepted → creates a Draft sales order and marks the quotation Accepted, BR-SAL-27), `cancel` (Draft / Submitted / Approved), `expire` (manual or the nightly job when Valid Till < today and status Sent or Approved).
**Filters:** Status, Customer, Salesperson, "Expiring in 7 days" (bool), Date range. **Totals:** Count, Grand Total, Accepted value. **Empty state:** standard.

### 2.10 `sales-orders` — Sales Orders (tables `sales_orders`, `sales_order_lines`)

**Register tab:** `Order Register`. **Prefix** `SO`. **Amount:** `grand_total` (frozen label `Total`).

| Tab | Renderer | What it shows / does |
|---|---|---|
| Order Register | registerTab | register of sales orders. |
| Order Items | v9LineItems | `[lines]` `LinesEditor` for the order (same as quotation; after approval only `promise date` of a line and cancellation of an unfulfilled remainder are editable). |
| Stock Allocation | v9Allocation | `[ws:sal.so.allocation]` per line of the selected order: ordered, delivered, available (BR-SAL-30), reserved, short (columns Demand / Available / Allocated / Short / Location) and buttons `Reserve`, `Release` that call the reservation actions. |
| Delivery Commitments | v9Logistics | `[ws:sal.so.commitments]` stepper Ordered → Reserved → Picked → Packed → Dispatched → Delivered for the order (state from the linked plans and dispatches) and the promise date vs plan / dispatch dates; list of dispatches with e-way and POD state. |
| Billing Status | v9Payment | `[ws:sal.so.billing]` table of invoices of the order (number, date, amount, paid, balance), invoiced %, delivered-not-invoiced and invoiced-not-delivered values, buttons `Create invoice` (policy On Order) / `Receive payment`. |
| Margin & Credit | v9Finance | `[ws:sal.so.margincredit]` order margin = taxable − cost (BR-SAL-24), credit check detail (limit, exposure, this order, available, overdue, decision, BR-SAL-50/51) and the override history. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | SO No | soNo | code | yes | auto `SO/<UNIT>/<FY>/0001` |
| 2 | Customer | customer | ref | yes | lookup `customers`, Active and not Blocked |
| 3 | PO Reference | poReference | ref | no | free text: the customer's PO number (max 60); duplicate warning for the same customer + PO ref (BR-SAL-28) |
| 4 | Order Date | orderDate | date | yes | default today, inside FY |
| 5 | Promise Date | promiseDate | date | no | ≥ order date; default = order date + customer lead time `sales_config.default_lead_days` |
| 6 | Warehouse | warehouse | ref | no | lookup `warehouses`, must be in the context unit; the default issuing warehouse of the lines |
| 7 | Currency | currency | text | no | read-only `INR` |
| 8 | Subtotal | subtotal | money | no | read-only |
| 9 | Discount | discount | money | no | read-only |
| 10 | GST | gst | money | no | read-only |
| 11 | Freight | freight | money | no | editable |
| 12 | Total | total | money | no | read-only, rounded |
| 13 | Credit Check | creditCheck | bool | no | read-only: true when the last credit check passed or was overridden |
| 14 | Salesperson | salesperson | ref | no | lookup `users` |
| 15 | Status | status | status | no | below |
| 16 | `[ADD]` Quotation | quotation | ref | no | read-only link |
| 17 | `[ADD]` Invoice Policy | invoicePolicy | enum | no | On Delivery (default) or On Order (BR-SAL-36) |
| 18 | `[ADD]` Place of Supply | placeOfSupply | enum | no | state list |
| 19 | `[ADD]` Ship To | shipTo | ref | no | lookup of the customer's shipping addresses (stored `ship_to_address_id`) |
| 20 | `[ADD]` Payment Terms | paymentTerms | ref | no | lookup `payment-terms` |
| 21 | `[ADD]` PO Date | poDate | date | no | |
| 22 | `[ADD]` Hold Reason | holdReason | text | no | read-only, set when On Hold |
| 23 | `[ADD]` Is Replacement | isReplacement | bool | no | read-only, set for return replacements |
| 24 | `[ADD]` Notes | notes | longtext | no | |

**Statuses:** Draft → Pending Approval → Approved → Partially Delivered → Delivered → Invoiced → Closed; On Hold (credit or manual) ↔ Approved; Cancelled. (Foundation mapping: Pending Approval ≙ Submitted, Approved/Partially Delivered ≙ In Process, Closed ≙ Completed.) Status progress is computed from line counters (BR-SAL-37).
**Actions:** `submit` (Draft → Pending Approval, or → Approved directly when the user has `approve` and the order is within authority, BR-SAL-26), `approve` / `reject` (reject → Draft), the credit check runs on approve (BR-SAL-50): failure → On Hold; `release-hold` (needs `approve`, segregation, BR-SAL-52), `hold` (manual), `reserve-all`, `create-delivery-plan`, `create-dispatch`, `create-invoice` (policy On Order, or an advance invoice), `short-close` (Approved / Partially Delivered: sets the undelivered remainder of each line to cancelled, BR-SAL-33, needs `delete`), `close` (Invoiced / Delivered with nothing open → Closed), `cancel` (Draft, Pending Approval, Approved, On Hold when nothing delivered or invoiced; releases reservations).
**Filters:** Status, Customer, Salesperson, Warehouse, "Credit check failed" (bool), "Past promise date" (bool), Date range. **Totals:** Count, Total, Open (undelivered) value.

### 2.11 `sales-reservations` — Stock Reservations (table `sales_reservations`)

**Register tab:** `Reservation Queue`. **Prefix** `RSV`. **Amount:** null.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Reservation Queue | registerTab | register of reservations, highest priority and earliest promise date first. |
| Warehouse Allocation | v9Allocation | `[ws:sal.rsv.warehouse]` per item and warehouse: on hand, reserved (all), available, demand open (Σ short of Open / Partially Reserved reservations); button `Reserve` for a row. |
| Batch Serial Allocation | v9Allocation | `[ws:sal.rsv.batch]` reservations of batch-tracked / serial-tracked items with the batch/serial text entered; when the Inventory plan ships batch balances this tab reads them (BR-SAL-31); until then it shows the items flagged `batch_tracked` / `serial_tracked` and their free-text batch. |
| Expiry Priority | v9Ageing | `[ws:sal.rsv.expiry]` reservations bucketed by days to `expiry_date` (expired, 0-3, 4-7, over 7) and the table sorted by expiry; button `Extend` / `Release`. |
| Release & Reallocate | v9Workflow | `[ws:sal.rsv.release]` lanes Open / Reserved / Released with `Move Forward` = reserve, `Release`; reallocate to another warehouse. |
| Reservation Exceptions | v9Allocation | `[ws:sal.rsv.exceptions]` shortages (short qty > 0), expired holds, reservations whose order is On Hold or Cancelled, reservations for stock that is no longer available (on hand < reserved after an adjustment). |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Reservation No | reservationNo | code | yes | auto `RSV/…` |
| 2 | Demand Ref | demandRef | ref | no | lookup `sales-orders` (the demand); value = order id |
| 3 | Customer | customer | ref | yes | read-only when Demand Ref is set (taken from the order) |
| 4 | Item | item | ref | no | lookup `items` (an item of that order) |
| 5 | Warehouse | warehouse | ref | no | lookup `warehouses` (context unit) |
| 6 | Batch Serial | batchSerial | text | no | free text batch no or serials |
| 7 | Required Qty | requiredQty | qty | no | read-only when linked: the line's open qty (ordered − delivered − cancelled) |
| 8 | Reserved Qty | reservedQty | qty | no | read-only, set by actions |
| 9 | Short Qty | shortQty | qty | no | read-only = Required − Reserved (≥ 0) |
| 10 | Priority | priority | enum | no | Low, Normal, High, Urgent (default Normal) |
| 11 | Expiry Date | expiryDate | date | no | hold expiry: default order promise date + `reservation_hold_days` (7); the nightly job releases expired holds (BR-SAL-32) |
| 12 | Status | status | status | no | Open, Reserved, Partially Reserved, Released, Fulfilled, Cancelled |

**Actions:** `reserve` (reserve `min(short, available)`), `release` (body `{qty?}`), `reallocate` (body `{warehouseId}`), `extend` (body `{expiryDate}`), `cancel`. Created automatically when an order is approved (`sales_config.auto_reserve`, default true) one row per stockable line; manual Add is allowed for an Approved order. **Filters:** Status, Warehouse, Item, Customer, Priority, "Short only" (bool), "Expiring in 3 days" (bool). **Totals:** Required, Reserved, Short (sums).

### 2.12 `sales-delivery` — Delivery Scheduling (tables `sales_delivery_plans`, `sales_delivery_plan_lines`)

**Register tab:** the first tab (`Delivery Plan`). **Prefix** `DLP`. **Amount:** null.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Delivery Plan | v9Logistics | the register (frozen columns) with, above it, a stepper Planned → In Transit → Delivered counts. |
| Promise Dates | v9Logistics | `[ws:sal.dlv.promise]` open order lines grouped by promise date week: qty, value, customers; red when promise date < today and open qty > 0; button `Re-promise` (edits the plan promise date, BR-SAL-38 keeps history). |
| Route & Vehicle | v9Logistics | `[ws:sal.dlv.route]` plans grouped by route and vehicle (free text from the plan), consolidated weight/volume if item weights exist (BR-SAL-39), list of stops in sequence. |
| Load Planning | v9Logistics | `[ws:sal.dlv.load]` for the selected vehicle/day: Σ gross weight and packages vs `vehicle capacity` entered in the plan (`[ADD]` capacity kg), utilisation bar, over-capacity warning. |
| Delivery Exceptions | v9Logistics | `[ws:sal.dlv.exceptions]` plans late (promise date < today, not Delivered), short deliveries, plans without vehicle on the day, orders On Hold; severity list. |
| OTIF Performance | v9HRWorkspace look | `[ws:sal.dlv.otif]` OTIF % (BR-SAL-89) overall, per customer, per route, per month; late vs short split. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Delivery Plan No | deliveryPlanNo | code | yes | auto `DLP/…` |
| 2 | Sales Order | salesOrder | ref | no | lookup `sales-orders` (Approved or Partially Delivered) |
| 3 | Customer | customer | ref | yes | taken from the order; free choice when no order |
| 4 | Ship To | shipTo | text | no | address text (default from the order's ship-to) |
| 5 | Promise Date | promiseDate | date | no | default order promise date |
| 6 | Route | route | text | no | e.g. "Pune-Mumbai-1" |
| 7 | Transporter | transporter | ref | no | free text until the Logistics module exists |
| 8 | Vehicle | vehicle | ref | no | free text (vehicle no, validated `^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$` upper-cased) |
| 9 | Planned Qty | plannedQty | qty | no | read-only Σ plan lines |
| 10 | Delivered Qty | deliveredQty | qty | no | read-only Σ dispatched qty of dispatches linked to the plan |
| 11 | POD | pod | text | no | read-only: POD reference of the latest delivered dispatch |
| 12 | OTIF Status | otifStatus | enum | no | Pending, On Time In Full, Late, Short, Late and Short (read-only, BR-SAL-89) |
| 13 | Status | status | status | no | Draft, Planned, In Transit, Partially Delivered, Delivered, Cancelled |
| 14 | `[ADD]` Planned Date | plannedDate | date | no | the date the vehicle is planned to go |
| 15 | `[ADD]` Vehicle Capacity (kg) | vehicleCapacityKg | qty | no | |
| 16 | `[ADD]` Re-promise Reason | repromiseReason | text | no | |

**Actions:** `plan` (Draft → Planned; validates BR-SAL-33 qty ≤ open qty), `create-dispatch` (creates the Dispatch from the plan lines), `repromise` (body `{promiseDate, reason}`), `cancel`. In Transit / Partially Delivered / Delivered are set by dispatch events. **Filters:** Status, Customer, Route, OTIF Status, Promise date range. **Totals:** Plans, Planned Qty, Delivered Qty.

### 2.13 `sales-dispatch` — Dispatch (tables `sales_dispatches`, `sales_dispatch_lines`) = the delivery note / challan that moves stock

**Register tab:** `Dispatch Queue`. **Prefix** `DSP` (taken at creation; the dispatch document is an internal doc; the GST invoice number is separate). **Amount:** `goods_value` (Σ taxable value of lines).

| Tab | Renderer | What it shows / does |
|---|---|---|
| Dispatch Queue | registerTab | register ordered by planned date. |
| Pick Pack Readiness | v9Allocation | `[ws:sal.dsp.readiness]` per line of the selected dispatch: required, reserved, on hand, picked, packed, short; buttons `Pick`, `Pack` (the actions). |
| Vehicle & Driver | v9Logistics | `[ws:sal.dsp.vehicle]` stepper Ready → Picked → Packed → Dispatched → Delivered; editable vehicle no, driver name and mobile, transporter, LR no and date (saves with PATCH while not Dispatched). |
| Dispatch Documents | v9Logistics | `[ws:sal.dsp.documents]` checklist: tax invoice posted, IRN generated (if applicable), e-way bill number and validity (rule BR-SAL-41), challan printed, packing list; each ✓ / ✗ with the missing item. |
| POD Status | v9Logistics | `[ws:sal.dsp.pod]` dispatches Dispatched but without POD (age in days), POD received, disputed; `Record POD` button (body: POD ref, date, received qty, remarks). |
| Dispatch Analytics | v9Logistics | `[ws:sal.dsp.analytics]` dispatches per day/week, average pick-to-dispatch hours, dispatch to POD days, per warehouse, per transporter. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Dispatch No | dispatchNo | code | yes | auto |
| 2 | Sales Order | salesOrder | ref | no | lookup `sales-orders` (Approved or Partially Delivered; required unless type is Sample / Job Work) |
| 3 | Customer | customer | ref | yes | from the order |
| 4 | Warehouse | warehouse | ref | no | lookup `warehouses`, context unit; stock is issued from here |
| 5 | Pick List | pickList | text | no | read-only `PL-<dispatchNo suffix>` set at `pick` |
| 6 | Packing Ref | packingRef | ref | no | free text (package/pallet ids) |
| 7 | Vehicle | vehicle | ref | no | free text vehicle no |
| 8 | Driver | driver | ref | no | free text driver name |
| 9 | Dispatch Date | dispatchDate | date | yes | default today |
| 10 | E Way Bill | eWayBill | text | no | 12 digits `^\d{12}$` (BR-SAL-41) |
| 11 | LR No | lrNo | text | no | lorry receipt no |
| 12 | POD Status | podStatus | enum | no | Pending (default), Received, Disputed, Not Required |
| 13 | Status | status | status | no | Planned, Picked, Packed, Dispatched, Delivered, Cancelled |
| 14 | `[ADD]` Dispatch Type | dispatchType | enum | no | Sale (default), Sample, Replacement, Job Work (BR-SAL-42) |
| 15 | `[ADD]` Delivery Plan | deliveryPlan | ref | no | read-only link |
| 16 | `[ADD]` Invoice | invoice | ref | no | read-only: the invoice created from this dispatch |
| 17 | `[ADD]` Transporter | transporter | text | no | |
| 18 | `[ADD]` Transporter ID (GSTIN) | transporterGstin | gstin | no | for Part A of the e-way bill when the vehicle is not yet known |
| 19 | `[ADD]` Distance (km) | distanceKm | qty | no | for the e-way validity (BR-SAL-41) |
| 20 | `[ADD]` E-Way Valid Upto | eWayValidUpto | datetime | no | entered or computed (BR-SAL-41) |
| 21 | `[ADD]` Packages | packages | qty | no | number of packages, required by `pack` |
| 22 | `[ADD]` Gross Weight (kg) | grossWeightKg | qty | no | |
| 23 | `[ADD]` POD Reference | podReference | text | no | |
| 24 | `[ADD]` POD Date | podDate | date | no | |

**Statuses:** Planned → Picked → Packed → Dispatched → Delivered; Cancelled. Editable in Planned / Picked / Packed.
**Actions:** `pick` (checks reservation or stock for every line, sets the pick list no), `pack` (needs Packages ≥ 1), `create-invoice` (Packed or later, creates a Draft invoice from the lines, BR-SAL-35/36), `dispatch` (Packed → Dispatched: BR-SAL-34 posts the stock issue + `DELIVERY_POSTED`; needs the invoice rule BR-SAL-35 and the e-way rule BR-SAL-41; `Idempotency-Key`), `record-pod` (Dispatched → Delivered), `dispute-pod`, `cancel` (Planned / Picked / Packed: releases picks; Dispatched / Delivered: reversal (stock RECEIPT of the issued qty at the issue value) only if no posted invoice references it and with `delete` permission, BR-SAL-34).
**Filters:** Status, Warehouse, Customer, POD Status, Date range, Dispatch Type. **Totals:** Dispatches, Goods value, Awaiting POD.

### 2.14 `sales-invoices` — Sales Invoices (tables `sales_invoices`, `sales_invoice_lines`, `sales_credit_notes`, `sales_credit_note_lines`)

**Register tab:** `Invoice Register`. **Number:** tax invoice `<UNIT>/<FYYY>/<NNNNN>` e.g. `TAL/2627/00001` (14 characters), assigned **at post** (gap-free; Draft carries `code = DRAFT/<8 hex>`; BR-SAL-43). **Amount:** `grand_total`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Invoice Register | registerTab | register of invoices. |
| Tax Breakdown | v9TaxWorkspace | `[ws:sal.inv.tax]` stepper Source Data → Tax Validation → Document Generation → Portal Status → Reconciliation with real state per step, and the table by HSN × rate: taxable, CGST, SGST, IGST, cess (the GSTR-1 HSN summary of the selected invoice or of the period). |
| E-Invoice Status | v9TaxWorkspace | `[ws:sal.inv.einvoice]` per invoice: applicability (BR-SAL-44), IRN status, IRN, ack no/date, days since invoice date, red from day 25 and "cannot report" after day 30 for AATO ≥ ₹10 Cr; buttons `Generate IRN` / `Record IRN` / `Cancel IRN (24h)`. |
| Receipts & Balance | v9Payment | `[ws:sal.inv.receipts]` for the selected invoice: grand total, TDS, paid, credit notes, balance; table of allocations (receipt no, date, amount) and `Receive payment` (opens a Draft receipt prefilled). |
| Credit Notes | v9Payment | `[ws:sal.inv.creditnotes]` credit notes of the invoice (number, date, reason, amount, status) and `Create credit note` (BR-SAL-46). |
| Invoice Ageing | v9Ageing | `[ws:sal.inv.ageing]` receivable ageing buckets Current / 1-30 / 31-60 / 61-90 / over 90 days past due (BR-SAL-90) per customer; hand-off note "Finance ageing report reads the same view `v_sales_receivable`". |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Invoice No | invoiceNo | code | yes | `DRAFT/…` then `TAL/2627/00001` at post |
| 2 | Customer | customer | ref | yes | lookup `customers` |
| 3 | Invoice Date | invoiceDate | date | yes | default today; the GST date of supply; inside FY; not before the last posted invoice date? (no: only within FY and not in a closed period) |
| 4 | Due Date | dueDate | date | no | = invoice date + payment-terms days (BR-SAL-06); editable in Draft |
| 5 | GSTIN | gstin | gstin | no | read-only snapshot of the billing GSTIN |
| 6 | Place of Supply | placeOfSupply | enum | no | state list `27-Maharashtra` |
| 7 | Taxable Value | taxableValue | money | no | read-only |
| 8 | CGST | cgst | money | no | read-only |
| 9 | SGST | sgst | money | no | read-only |
| 10 | IGST | igst | money | no | read-only |
| 11 | Grand Total | grandTotal | money | no | read-only, rounded |
| 12 | Paid | paid | money | no | read-only = Σ allocations + TDS allocated |
| 13 | Balance | balance | money | no | read-only = Grand Total − Paid − credit notes applied |
| 14 | IRN Status | irnStatus | enum | no | Not Applicable, Pending, Generated, Cancelled, Failed (read-only) |
| 15 | Status | status | status | no | Draft, Posted, Partially Paid, Paid, Cancelled |
| 16 | `[ADD]` Sales Order | salesOrder | ref | no | read-only |
| 17 | `[ADD]` Dispatch | dispatch | ref | no | read-only |
| 18 | `[ADD]` Invoice Type | invoiceType | enum | no | Tax Invoice (default), Bill of Supply, Export (LUT), SEZ (LUT) |
| 19 | `[ADD]` Freight | freight | money | no | editable in Draft |
| 20 | `[ADD]` Round Off | roundOff | money | no | read-only |
| 21 | `[ADD]` IRN | irn | text | no | read-only 64 hex |
| 22 | `[ADD]` Ack No | ackNo | text | no | read-only |
| 23 | `[ADD]` Ack Date | ackDate | datetime | no | read-only |
| 24 | `[ADD]` TDS Receivable | tdsReceivable | money | no | the TDS the customer may deduct (BR-SAL-47), informational |
| 25 | `[ADD]` PO Reference | poReference | text | no | printed |

**Statuses:** Draft → Posted → Partially Paid → Paid; Cancelled. Posted / Partially Paid / Paid are locked (no edit, no delete).
**Actions:** `post` (Draft → Posted; number assigned; stock is NOT touched; event `SALES_INVOICE_POSTED`; BR-SAL-43), `generate-irn` / `record-irn` / `cancel-irn` (BR-SAL-44), `cancel` (Draft: soft cancel; Posted: allowed only when nothing is paid or allocated, no credit note exists, and (IRN absent or cancelled within 24 hours); posts the reversing event `SALES_INVOICE_CANCELLED`; needs `delete`), `create-credit-note`, `receive-payment`. A posted invoice is **never edited**; corrections are credit / debit notes (BR-SAL-46).
**Filters:** Status, IRN Status, Customer, Overdue (bool), Invoice type, Date range. **Totals:** Taxable, GST (CGST+SGST+IGST), Grand Total, Outstanding.

### 2.15 `sales-collections` — Collections (tables `sales_collections`, `sales_collection_allocations`, `sales_collection_actions`)

**Register tab:** `Collection Worklist` (matches "list"). The record = a **customer receipt** (money in) allocated to invoices; the worklist / promises / escalations are the collection **actions** on overdue invoices. **Prefix** `COL` assigned **at post**. **Amount:** `receipt_amount`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Collection Worklist | v9Payment | the register of receipts; above it a worklist table of overdue invoices (customer, invoice, due date, outstanding, days overdue, last action) with buttons `Log call`, `Promise`, `Receive`. |
| Due Today | v9Payment | `[ws:sal.col.today]` invoices with due date = today or promise date = today, grouped by collector. |
| Promise to Pay | v9Payment | `[ws:sal.col.promises]` open promises (date, amount, customer, invoice, collector), broken promises (promise date < today and still unpaid) in red; `Mark kept` / `Re-promise`. |
| Receipt Allocation | v9Allocation | `[ws:sal.col.allocation]` unallocated receipts and advances: amount, customer, open invoices of the customer with suggested allocation (oldest first, BR-SAL-40) and `Allocate` (manual amounts). |
| Escalation Actions | v9Workflow | `[ws:sal.col.escalation]` ladder Reminder (day +1) → Call (+7) → Manager (+15) → Credit hold (+30) with the invoices at each rung (days overdue from `sales_config.dunning_days`), button `Escalate`. |
| DSO Analytics | analyticsTab | `[ws:sal.col.dso]` DSO (BR-SAL-84) by month and by customer, collection effectiveness index, average days to collect, promise-kept rate. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Collection No | collectionNo | code | yes | `DRAFT/…` then `COL/<UNIT>/<FY>/0001` (FY like `26-27`) at post |
| 2 | Customer | customer | ref | yes | lookup `customers` |
| 3 | Invoice No | invoiceNo | ref | no | lookup `invoices` (the primary invoice; allocations may cover more) |
| 4 | Due Date | dueDate | date | no | read-only: due date of the primary invoice |
| 5 | Outstanding | outstanding | money | no | read-only: balance of the primary invoice, else the customer's total outstanding |
| 6 | Promise Date | promiseDate | date | no | read-only: the latest open promise (from `sales_collection_actions`) |
| 7 | Collector | collector | ref | no | lookup `users` |
| 8 | Contact Mode | contactMode | enum | no | Call, Email, WhatsApp, Visit, Letter |
| 9 | Receipt Amount | receiptAmount | money | no | > 0 to post (the net amount received in the bank/cash) |
| 10 | Receipt Date | receiptDate | date | yes | default today, inside FY, not in the future |
| 11 | Reference | reference | ref | no | free text: UTR / cheque no / UPI ref (duplicate warning for the same customer, mode and reference) |
| 12 | Status | status | status | no | Draft, Posted, Bounced, Cancelled |
| 13 | `[ADD]` Payment Mode | paymentMode | enum | no | Bank Transfer, Cheque, UPI, Cash, Card, Adjustment (required to post) |
| 14 | `[ADD]` TDS Deducted | tdsDeducted | money | no | TDS the customer deducted (BR-SAL-47); reduces the invoice balance together with the cash |
| 15 | `[ADD]` Unallocated | unallocated | money | no | read-only = Receipt + TDS − Σ allocations (an advance, BR-SAL-40) |
| 16 | `[ADD]` Deposit Account | depositAccount | text | no | bank / cash account name (Finance maps it) |
| 17 | `[ADD]` Cheque Date | chequeDate | date | no | |

**Statuses:** Draft → Posted → Cancelled | Bounced. **Actions:** `post` (BR-SAL-40; event `RECEIPT_RECEIVED`), `allocate` (body `{allocations:[{invoiceId, amount}]}` on a Posted receipt with an unallocated rest), `cancel` (Posted → Cancelled, reverses allocations, needs `delete`), `bounce` (Posted → Bounced, reverses allocations and re-opens the invoices, needs `delete`). Promise / call logging: `POST /api/v1/sales/collections/actions` (BR-SAL-48).
**Filters:** Status, Customer, Collector, Payment Mode, Date range, "Unallocated only". **Totals:** Receipts, Receipt Amount, Unallocated.

### 2.16 `sales-pricelist` — Price Lists (tables `price_lists`, `price_list_items`, `customer_item_prices`)

**Register tab:** `Price List Master` (matches "list"). Master document with code user-entered (`PL-DEALER-2026`); **no numbering**. **Amount:** null.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Price List Master | v9Finance | the register of price lists. |
| Customer Pricing | v9Finance | `[ws:sal.pl.customer]` + editor: `customer_item_prices` (customer, item, customer part no, price, min qty, validity); also shows which price list each customer is on. |
| Quantity Slabs | v9Finance | editor `PriceItemsEditor` for the selected list: rows (item or category, min qty, price or discount %, valid from/to); slabs of the same item must have distinct min qty (BR-SAL-20). |
| Promotion Rules | v9Rules | `[ws:sal.pl.promos]` the PROMO rows (name, item/category, min qty, discount %, dates) with enable toggle (= `is_active`), never stackable with another promo (best single discount wins, BR-SAL-20). |
| Effective Dates | v9Calendar | `[ws:sal.pl.dates]` timeline / month grid of validity ranges of all active lists, overlaps in red. |
| Margin Simulation | v9Finance | `[ws:sal.pl.simulate]` pick customer, item, qty, date → shows the resolved price with the trace (which rule won, BR-SAL-20), cost, margin %, floor and the discount authority result; calls `POST /api/v1/sales/price/resolve`. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Price List Code | priceListCode | code | yes | user-entered master code |
| 2 | Price List Name | priceListName | text | yes | 2-100 |
| 3 | Customer Segment | customerSegment | enum | no | Dealer, OEM, Distributor, Retail, Government, Export, Internal, All |
| 4 | Item Category | itemCategory | enum | no | `All` + the distinct `items.category` values (built at schema time) |
| 5 | Currency | currency | text | no | `INR` (read-only v1) |
| 6 | Base Price | basePrice | money | no | optional flat price for any item of the category not listed in the items table |
| 7 | Min Qty | minQty | qty | no | list-level minimum order qty (below it the list does not apply) |
| 8 | Discount % | discountPct | pct | no | default % off the item's `selling_price` for items not listed |
| 9 | Effective From | effectiveFrom | date | yes | |
| 10 | Effective To | effectiveTo | date | no | ≥ From; empty = open ended |
| 11 | Margin % | marginPct | pct | no | margin floor of this list (BR-SAL-21) |
| 12 | Status | status | status | no | Draft, Active, Inactive |
| 13 | `[ADD]` Is Default | isDefault | bool | no | the list used when the customer has none (one per currency) |
| 14 | `[ADD]` Notes | notes | longtext | no | |

**Actions:** `activate` (checks overlap BR-SAL-20: 409 `PRICE_LIST_OVERLAP`), `deactivate`, `clone` (copies items, new code in body). Delete: Draft only; 409 `IN_USE` when a customer, quotation or order uses it. **Filters:** Status, Segment, Category, "Valid on" (date). **Totals:** Lists, Active lists.

### 2.17 `sales-credit` — Credit Limits (tables `credit_profiles`, `credit_holds`; reads `parties`, `sales_invoices`)

**Register tab:** the first tab (`Credit Profiles`): one row per active customer. **Code** = the customer code (no numbering). **Amount:** `used_limit`.

| Tab | Renderer | What it shows / does |
|---|---|---|
| Credit Profiles | v9Operations | the register of customers' credit profiles (frozen columns) with Credit Limit editable inline (needs `edit`). |
| Limit Utilization | analyticsTab | `[ws:sal.cr.utilization]` bars Used / Limit per customer (top 20 by utilisation %), customers over 90 % amber, over 100 % red; exposure formula shown (BR-SAL-50). |
| Overdue Exposure | v9Ageing | `[ws:sal.cr.overdue]` overdue amount per age bucket and per customer, oldest due days. |
| Credit Holds | v9Exceptions | `[ws:sal.cr.holds]` active holds (customer, since, reason, orders blocked, amount) and `Release` (BR-SAL-52). |
| Approval Overrides | v9Approval | `[ws:sal.cr.overrides]` pending override requests (orders On Hold waiting for an approver) and the history of overrides (who, when, reason, amount, expiry). |
| Risk Scoring | v9Exceptions | `[ws:sal.cr.risk]` the risk grade rule (BR-SAL-53) and each customer's inputs: average days late (12 months), share of late invoices, bounced receipts, overdue %, tenure; computed grade vs set grade. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Customer Code | customerCode | code | yes | read-only: `parties.code` |
| 2 | Customer | customer | ref | yes | read-only |
| 3 | Credit Limit | creditLimit | money | no | editable; empty = no limit; 0 = no credit (BR-SAL-50) |
| 4 | Used Limit | usedLimit | money | no | read-only: exposure (BR-SAL-50) |
| 5 | Available Limit | availableLimit | money | no | read-only = limit − used (≥ 0 shown; negative shown red) |
| 6 | Overdue | overdue | money | no | read-only: Σ balance of Posted invoices past due |
| 7 | Oldest Due Days | oldestDueDays | qty | no | read-only: max days past due |
| 8 | Risk Grade | riskGrade | enum | no | A, B, C, D (set manually or accepted from the computed grade) |
| 9 | Hold Status | holdStatus | enum | no | None, On Hold, Override Active, Released (read-only, actions) |
| 10 | Override Approver | overrideApprover | ref | no | lookup `users`; the person who may release this customer's holds (must hold `approve` on this page) |
| 11 | Review Date | reviewDate | date | no | next credit review; the nightly job lists overdue reviews |
| 12 | Status | status | status | no | Active, Inactive, Blocked |
| 13 | `[ADD]` Credit Days | creditDays | qty | no | from the customer (payment terms) |
| 14 | `[ADD]` Max Overdue Days | maxOverdueDays | qty | no | default `sales_config.default_max_overdue_days` (30) |
| 15 | `[ADD]` Hold Reason | holdReason | text | no | read-only |

**Actions:** `hold` (manual hold, reason required, needs `edit`), `release-hold` (body `{reason, overrideUntil?, overrideAmount?}`; needs `approve`; approver must differ from the user who created the order / hold, BR-SAL-52), `accept-grade` (copies the computed grade), `recalculate`. **Filters:** Hold Status, Risk Grade, Status, "Over limit" (bool), "Overdue" (bool). **Totals:** Customers, Σ Credit Limit, Σ Used, Σ Overdue.

### 2.18 `sales-returns` — Sales Returns (tables `sales_returns`, `sales_return_lines`)

**Register tab:** `Return Register`. **Prefix** `SRT`. **Amount:** `return_value` (Σ line taxable values).

| Tab | Renderer | What it shows / does |
|---|---|---|
| Return Register | registerTab | register of returns. |
| Return Reason | v9Workflow | `[ws:sal.ret.reasons]` lanes by reason code (Defective, Damaged in transit, Wrong item, Excess, Quality reject, Other) with cards and counts. |
| Inspection & Disposition | v9Quality | `[ws:sal.ret.inspection]` per return line parameter table (qty received, qty accepted, condition, disposition) with `Save inspection` (writes the line); Pass / Fail per line. |
| Credit Note Link | v9Payment | `[ws:sal.ret.creditnote]` the credit note of the return (number, date, amount, GST reversed, IRN status) or the button `Issue credit note`; shows the 30 November deadline of Section 34 for the original invoice (BR-SAL-46). |
| Replacement Flow | v9Workflow | `[ws:sal.ret.replacement]` lanes Requested → Approved → Received → Replacement order → Dispatched for returns with disposition Replace; button `Create replacement order`. |
| Return Analytics | analyticsTab | `[ws:sal.ret.analytics]` return rate % (returned value / invoiced value) by customer, item, reason, month; credit note value; top 10 returned items. |

| # | Label | key | type | req | Notes |
|---|---|---|---|---|---|
| 1 | Return No | returnNo | code | yes | auto |
| 2 | Customer | customer | ref | yes | lookup `customers` |
| 3 | Invoice Ref | invoiceRef | ref | no | lookup `invoices` (Posted, same customer); required to receive / credit |
| 4 | Return Date | returnDate | date | no | default today |
| 5 | Item | item | ref | no | lookup `items`; with Qty creates the single line (see below) |
| 6 | Qty | qty | qty | no | > 0; ≤ invoiced − already returned (BR-SAL-45) |
| 7 | Reason | reason | longtext | no | |
| 8 | Condition | condition | longtext | no | |
| 9 | Disposition | disposition | enum | no | Restock, Scrap, Rework, Replace, Quarantine |
| 10 | Credit Note Ref | creditNoteRef | ref | no | read-only |
| 11 | Replacement Ref | replacementRef | ref | no | read-only: the replacement sales order |
| 12 | Status | status | status | no | Requested, Approved, Received, Credit Note Issued, Rejected, Cancelled |
| 13 | `[ADD]` Reason Code | reasonCode | enum | no | Defective, Damaged in Transit, Wrong Item, Excess, Quality Reject, Other |
| 14 | `[ADD]` Return Warehouse | returnWarehouse | ref | no | lookup `warehouses`; default `sales_config.returns_warehouse_id` else the original dispatch warehouse |
| 15 | `[ADD]` Lines | lines | — | no | not a field: the multi-line editor `ReturnLinesEditor` (tab Inspection & Disposition / drawer) via `data.lines` (plan 03 C4) |

**Single-line shortcut:** when the Add form gives Invoice Ref + Item + Qty and no lines, the server creates one line from the invoice line of that item (422 `LINE_AMBIGUOUS` if the invoice has the item twice).
**Statuses:** Requested → Approved → Received → Credit Note Issued; Rejected; Cancelled. **Actions:** `approve`, `reject` (reason), `receive` (BR-SAL-45: stock receipt per line disposition, event `SALES_RETURN_POSTED`), `issue-credit-note` (Received → Credit Note Issued), `create-replacement`, `cancel` (Requested / Approved). **Filters:** Status, Customer, Reason Code, Disposition, Date range. **Totals:** Returns, Return value, Credited.

*End of section 2 (18 pages).*
