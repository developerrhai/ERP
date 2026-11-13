# PHASE 32 — V40 Pixel-Exact UI Parity, Responsive Polish & Print Stylesheets

## 1. Goal
Deliver pixel-exact visual, layout, and responsive polish matching the client-approved `index.html` / V40 design across every built screen (`1440 px` desktop and `≤ 600 px` mobile), without changing API contracts or breaking accessibility:
1. eliminate remaining unstyled/inconsistent Tailwind or ad-hoc markup so every page uses the unified V40 CSS design tokens (`--bg`, `--card`, `--primary`, `--side`, `.btn`, `.card`, `.recordbar`, `.modal`, `.drawer`);
2. complete `@media print` stylesheets for registers, reports, and preview drawers;
3. keyboard navigation, focus rings, and automated visual regression snapshots on key screens.

## 2. Pages
No new business pages; sweeps all 250+ built pages across all menu families, plus:
- `LoginPage`, `AppShell` (Sidebar, Topbar, ContextSelectors, NotificationBell, AccountDrawer), `DashboardPage`, `DataTable`, `ActionBar`, `Modal`, `Drawer`.

## 3. Rules
- STANDARDS §10 + WCAG 2.1 AA (`axe-core` 0 serious/critical violations on representative pages across all families).
- `index.html` at repo root remains read-only (reference only).
- Zero horizontal scrollbars at `1440×900` desktop and `390×844` mobile viewports.

## 4. Database
- No database migrations (pure frontend CSS, layout, responsive, and visual-test phase).

## 5. Work, logic and examples
- **Design System Sweep:** Replace any remaining raw `<div className="p-6 ...">` / uncompiled utility classes in earlier modules (HR, Payroll, Projects, Service) with the unified `tokens.css` / `app.css` / `panels.css` classes (`PageHead`, `recordbar`, `card table-wrap`, `Modal`, `Field`, `SelectField`, `Pill`).
- **Mobile Breakpoints (`≤ 600 px`):** Collapsible off-canvas sidebar drawer, sticky ActionBar footer on drawers, responsive card-table scroll indicators, touch-friendly `44px` tap targets.
- **Visual Regression Suite:** Playwright `toHaveScreenshot()` baselines at `1440×900` and `390×844` for Login, Executive Dashboard, Sales Quotation, Journal Entry, Employee Directory, and Work Order.

## 6. API
- No API changes.

## 7. Screens
- Consistent typography, spacing, header alignment, status pill colors, and empty states across all 22+ menu families.
- Clean `@media print` hides sidebar/topbar/buttons when printing directly from browser.

## 8. Messages
- Verify all inline validation, toast, and empty-state strings follow STANDARDS §10 plain-English format.

## 9. Audit & notifications
- No changes.

## 10. Tests
- **Accessibility (`axe-core`):** 0 serious/critical violations across expanded family page suite.
- **Responsive Overflow Check:** Automated Playwright layout check asserts `document.documentElement.scrollWidth <= window.innerWidth` at `1440px` and `390px` across all pages in crawler.
- **Visual Baselines:** Playwright screenshot assertions pass cleanly.

## 11. Acceptance
- [ ] Zero uncompiled/broken layout classes across all HR/Payroll/Projects/Service/Admin/Core pages.
- [ ] Zero horizontal overflow on desktop (`1440px`) and mobile (`390px`) in full crawler.
- [ ] `axe-core` WCAG 2.1 AA checks pass with 0 serious/critical issues.
- [ ] 3 clean test runs.

## 12. Out of scope
Offline PWA sync queues & hardware barcode scanners (Phase 33), external GSTN/Bank APIs (Phase 34).

## 13. Owner check
1. Open the ERP on a mobile phone (`≤ 600 px`) and browse Employee Directory, Sales Quotations, and Journals. ✔️ Clean layout, no cut-off modals, readable tables.
2. Press `Ctrl+P` on any register table. ✔️ Sidebar/topbar hide cleanly for print.

## 14. Build prompt
~~~
Read CLAUDE.md, STANDARDS §10, ERRATA, and PHASE-32.md. Sweep all pages for V40 token/CSS parity,
fix mobile ≤600px responsiveness, add @media print rules, expand axe-core + overflow assertions in
Playwright crawler, and run 3× clean. Update STATUS.md, docs/clicntmassage.md, and
docs/client-test-guide.md. Write PHASE-32-REPORT.md.
~~~

## 15. Client documents
**clicntmassage.md — NEW in this update:**
- Unified V40 look and feel across every screen in the ERP, with mobile phone layout polish and clean browser print formatting.

**client-test-guide.md — add:**
- **Mobile Check:** Open ERP on phone → open Menu → open Sales Orders & HR Employees. ✔️ Modals and tables fit cleanly without horizontal page overflow.

