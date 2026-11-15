# ROLES SUMMARY (Phase 36 Part B)

Each role opened every V40 page id in the ERP. "Access denied" for a restricted role is correct; for the Super User it would be a bug. Non-Super roles were audited at 1440 px only.

| Role | Pages audited | Opened with content | Access denied | Not found | Page errors | Console errors | API errors (4xx/5xx) | Avg buttons shown |
|---|---|---|---|---|---|---|---|---|
| Super User | 327 | 327 | 0 | 0 | 0 | 6 | 6 | 21.3 |
| Administrator | 327 | 327 | 0 | 0 | 0 | 7 | 6 | 25.2 |
| Department Manager Purchase TAL | 327 | 126 | 201 | 0 | 0 | 2 | 2 | 12.0 |
| Employee Stores TAL | 327 | 129 | 198 | 0 | 0 | 0 | 0 | 10.8 |
| Sales user TAL+SAW | 327 | 103 | 224 | 0 | 0 | 6 | 6 | 8.8 |

## Pages a non-admin role can open that look admin-only (to review)

* Administrator: admin-company, admin-branches, admin-departments, admin-designations, admin-users, admin-roles, admin-permissions, admin-fy, admin-currency, admin-taxes, admin-numbering, admin-uom, admin-customfields, admin-formbuilder, admin-workflow
* Department Manager Purchase TAL: none
* Employee Stores TAL: none
* Sales user TAL+SAW: none
