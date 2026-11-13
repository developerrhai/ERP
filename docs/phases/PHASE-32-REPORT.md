# PHASE 32 — Report (partly done: CSS, print and phone rules built; the browser tests could NOT be run)

Built locally on 2026-11-13. Nothing committed, pushed or deployed. No API or database change.

## What was done
- **Found and fixed a real display bug:** the dialogs of the Phase 26-31 pages use the class `modal-backdrop`, which had **no style** (the app's own dialogs use `modal-bg`), so they would have appeared as plain blocks at the bottom of the page instead of a centred dialog with a dark backdrop. `.modal-backdrop`, `.modal-actions`, `.inline-form`, `.tabs-row`, `.row-actions` and `.automation-card` are now styled with the existing V40 tokens.
- **Phone layout (≤ 600 px):** dialogs become a bottom sheet with sticky buttons; tables scroll sideways inside their own box instead of widening the page; card rails, the Document Center and the automation grid become one column; filter rows stack; tabs scroll sideways; every button and field is at least 44 px high and fields are 16 px (no zoom on iPhone).
- **Keyboard:** a 3 px focus ring on buttons, links, fields, tabs and anything focusable.
- **Printing from the browser:** dialogs, tab rows, filter rows, row buttons, the Print menu and the View-as banner are hidden; tables print full width with borders; cards do not split across pages; page margins 12 mm.
- A small guard test (`apps/web/src/styles/phase32-css.test.ts`, 4 tests, pass): the overlay and print rules exist, focus and 44 px rules exist, and every dialog in the new pages is `role="dialog"`, `aria-modal` and named.

## NOT done (needs a running browser; blocked by memory and two old test servers on ports 4100 / 5180)
1. The **Playwright visual baselines** (`toHaveScreenshot` at 1440×900 and 390×844 for Login, Dashboard, Quotation, Journal, Employee Directory, Work Order).
2. The **axe-core** WCAG 2.1 AA run (0 serious / critical) and the **horizontal-overflow crawl** at 1440 and 390 px over every page.
3. The sweep of **older pages** (HR, Payroll, Projects, Service ...) for raw utility classes. Only the pages built in Phases 23-31 were checked for missing classes; the three CSS classes found missing were fixed.
4. Three clean full runs. The web unit-test suite still has its 56 old failing tests (stale expectations from earlier phases).

## Owner check (please do on a phone)
Open the ERP on a phone, open Menu ➜ Sales Orders and HRMS ➜ Employee Directory, then press Ctrl+P on a register: dialogs fit the screen, tables scroll inside their box, the sidebar and buttons do not print.
