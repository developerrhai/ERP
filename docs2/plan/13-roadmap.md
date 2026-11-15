Plan in docs/phases/: ROADMAP (R-01..R-41), STANDARDS (incl. R2-1..R2-9), ERRATA (E-01..E-41),
PHASE-22.md … PHASE-32.md. Reference UI: RHAI_ERP_V40_Edit_Update_Fixed.html (read-only).
ORDER: 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32.

STEP A — RESUME: read docs/phases/PROGRESS-R2.md (create if missing: Phase | Status
TODO/IN_PROGRESS/BLOCKED/DONE | Step | Started | Finished | Commit | Notes, plus a Log). Continue an
IN_PROGRESS phase at its step; else start the first TODO. If the newest log line is < 15 min old and
says "working", append "check-in" and stop. If all are DONE: write "RELEASE 2 COMPLETE", summarise,
stop the loop.

STEP B — ONE PHASE (record the step number as you go):
1  Read CLAUDE.md, STANDARDS, ROADMAP, ERRATA, the phase file, the previous report, the V40 code named
   in the build prompt.
2  Audit the current code against the phase → first section of PHASE-XX-REPORT.md.
3  Plan: migrations → calc + tests → services → API → UI → jobs → feeders → flows.
4  Build. Worked examples become tests first. Keep V40 ids, tabs, field names and button labels exactly.
   The login screen does not change (R-30). Plant scope everywhere (R-37, R2-6). Use the shared
   services; never re-implement them. No fake numbers; no statutory constant in code.
5  Feeders + flows (R2-7) for this phase's pages, through the screens, on *_e2e only.
6  ZERO-ERROR GATE (R2-4) ×3: typecheck, lint, unit, integration, e2e, feeders, flows, crawler
   (9 roles × plant combos) 0 errors, unbounded-list check, speed budget, axe.
7  Fresh reviewer sub-agent: checks §11 Acceptance, §8 messages, R2-1 look, R2-2 ActionBar, R-37 plant
   scope and V40 parity for this phase. Fix every FAIL, then repeat 6–7.
8  Write PHASE-XX-REPORT.md (audit, built, DB changes, tests ×3, acceptance ticks, owner checks, owner
   tasks, limits, DEPLOY SHEET per R2-9). Regenerate STATUS.md.
9  Update docs/clicntmassage.md (latest message, cumulative "ready so far") and add this phase's steps
   to docs/client-test-guide.md (by role) — §15 of the phase; logins only as <id>/<password>.
10 One local commit "feat(phase-XX): …" listing the DB changes. NEVER push. Mark DONE, continue.

EVERY 15 MINUTES: append "<time> | Phase XX | step N | working | done … | next …" to the log.

HARD RULES: never push or deploy; never touch prod or shared DBs (migrations local/test only; feeders
only on *_e2e/_staging); never read .env*, deploy_to_ec2*.ps1, .git internals or "doc from clint";
never edit plan files (except PROGRESS-R2.md, reports, STATUS.md, clicntmassage.md,
client-test-guide.md); never start a phase while anything is red; never delete working code to pass a
test; business choices are decided (R-01..R-41). BLOCKED (with an exact owner step) only for: a missing
earlier dependency, a plan contradiction, a needed secret/external account/device (use mocks or
simulators when the phase allows), or 3 failed fixes of the same test.

END OF EACH RUN: phase · step · tests 3/3 · crawler errors 0? · feeders/flows green? · commit ·
client docs updated? · blockers · next.

