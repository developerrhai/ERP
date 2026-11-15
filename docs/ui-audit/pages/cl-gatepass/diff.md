# Gate Pass & Access (cl-gatepass) - V40 vs ERP

Family: Contract Labour Management - role: super - 2026-11-14T14:27:27.337Z

## Tabs
V40: Gate Pass Register | Pass Issue | Zone Access | Shift Access | Block & Blacklist | Gate Audit | Analytics & Graphs | Calendar & Schedule | Documents | Approvals | Reports | Audit Trail
ERP: Inward Pass Register | Vehicle Entry | Material Details | Security Checks | Weighment | Exit Closure | Analytics & Graphs | Documents | Approvals | Reports | Audit Trail
Missing in ERP: Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule
Extra in ERP: Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure

## Tab: Gate Pass Register
- columns: V40 9, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 37, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Update, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Pass Issue
- columns: V40 16, ERP 0; **missing:** Exception, Record, Severity, Age, Root Cause, Owner, Action, Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 37, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Resolve, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 12, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Critical, Review, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 16, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Zone Access
- columns: V40 16, ERP 0; **missing:** Record, Demand, Available, Allocated, Short, Location, Action, Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 38, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Allocate, Reallocate, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 16, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Shift Access
- columns: V40 9, ERP 0; **missing:** Allowed Shift, Blacklist Status, Gate Status, Gate Pass No, Worker ID, Worker Name, Contractor Name, Status, Actions; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 38, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Profile, Create HR Follow-up, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Block & Blacklist
- columns: V40 15, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Allowed Units, Allowed Shift, Access Zones, Biometric ID, Vehicle No, Docs, Actions, Status; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 44, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Reset 25 Demo, Export Selected, Submit Selected, Delete Selected, View, Email, PDF, Submit, Previous, Next, Docs; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 2, ERP 7; **missing:** SELECT, Search Labour Gate Pass & Access...; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 16, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Gate Audit
- columns: V40 9, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 1, ERP 6; **missing:** Internal Note; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 38, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Add Note, Export Source Data, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Analytics & Graphs
- columns: V40 9, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 36, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 8, ERP 0; **missing:** Records8Data pointsAverage-26Gate Pass NoAI Risk21/100Contro, Records8Data points, Average-26Gate Pass No, AI Risk21/100Controlled, Data Quality100%Completeness, Analytics & Graphs • 20-Point Trend & Forecast, Status / Business Distribution, Analysis Summary; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Calendar & Schedule
- columns: V40 9, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 3, ERP 6; **missing:** Date, Subject, Owner; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 37, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, ＋ Add Schedule, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 3, ERP 0; **missing:** August 2026, Schedule / Reminder, Upcoming; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Documents
- columns: V40 9, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 5, ERP 6; **missing:** File, Category, Document No., Issue Date, Expiry Date; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 37, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, ＋ Add Document, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 1, ERP 0; **missing:** Document Addition; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Approvals
- columns: V40 14, ERP 6; **missing:** Request, Record, Current Role, Actions, Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant; extra: Document, Level, Waiting on
- fields: V40 0, ERP 0; **missing:** -; extra: -
- buttons: V40 36, ERP 31; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Privacy Notice (DPDP)
- cards: V40 0, ERP 0; **missing:** -; extra: -
- filters: V40 1, ERP 0; **missing:** SELECT; extra: -
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 1; sideways scroll ERP: false

## Tab: Reports
- columns: V40 9, ERP 0; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: -
- fields: V40 0, ERP 6; **missing:** -; extra: Vehicle Registration No, Driver Name, Driver Mobile, Supplier / Party, Weigh-In (kg), Challan Ref / Visitor Note
- buttons: V40 39, ERP 38; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, Download Excel, Download Letterhead PDF, Restore 25 Demo Rows, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Tablet Kiosk, Gate Register, Overdue Returnables (0), ↙️ Vehicle IN
- cards: V40 8, ERP 0; **missing:** Records8CurrentExcelReadyAll rowsLetterhead PDFReadyA4 compa, Records8Current, ExcelReadyAll rows, Letterhead PDFReadyA4 company format, Data Quality100%Validated, Report Trend Preview • 20 Points, Report Distribution, Reports & Downloads; extra: -
- filters: V40 1, ERP 7; **missing:** SELECT; extra: MH12AB1234, Driver Name, 98XXXXXXXX, Supplier Name, 0, Supplier Challan No, Visitor / Purpose note
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 0 **(empty data)**; sideways scroll ERP: false

## Tab: Audit Trail
- columns: V40 9, ERP 4; **missing:** Gate Pass No, Worker ID, Worker Name, Contractor Name, Issue Date, Valid Until, Site / Plant, Status, Actions; extra: When, Person, Action, Record
- fields: V40 0, ERP 0; **missing:** -; extra: -
- buttons: V40 36, ERP 33; **missing:** ＋ Add New, Load Selected, ＋ Add, Gate Pass Register, Pass Issue, Zone Access, Shift Access, Block & Blacklist, Gate Audit, Calendar & Schedule, PDF, View, Docs, Email; extra: ⚙ Settings, 360° Tracking, Inward Pass Register, Vehicle Entry, Material Details, Security Checks, Weighment, Exit Closure, Previous, Next, Privacy Notice (DPDP)
- cards: V40 1, ERP 0; **missing:** Audit Trail; extra: -
- filters: V40 1, ERP 0; **missing:** SELECT; extra: -
- badges: V40 10, ERP 0; **missing:** Department: Administration, Role: Super User, Owner: Administration, Approval: Required, Approved, In Progress, Pending, Ready, Completed, Active; extra: -
- rows: V40 8, ERP 1; sideways scroll ERP: false

