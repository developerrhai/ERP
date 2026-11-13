Hi [Client Name],

Hope you're doing well! 😊

Good news: the complete ERP platform through **Phase 34** is ready, and it is live on the same website. It now covers:
- Buying material and quality checks
- **Making your products** (with job cards, costs, and a tablet screen for the shop floor)
- **Keeping your machines running and looking after your assets**
- Selling, delivery, and payments
- **Managing your team (HRMS)** (employee profiles with verified Aadhaar/Bank details, biometric attendance, leaves, and expense claims)
- **Running monthly payroll** (compliant with Indian labour laws, Code on Wages, PF, ESIC, PT Maharashtra, TDS, payslip PDFs, and bank payout files)
- **Customer projects** (interactive Gantt charts, critical path scheduling, Kanban boards, timesheets, and project profitability)
- **After-sales service, AMCs & warranties** (service desk with SLA timers, auto-dispatching technicians, mobile visit checklists with customer signatures, AMC straight-line revenue, and supplier warranty claims)
- **Logistics, Fleet, Gate Security & Document Vault (DMS)** (shipment Kanban & ISO containers, freight slab rate cards, CMVR vehicle expiry & full-tank fuel logs, tablet Gate Kiosk with E-Way Bill check & CGST Rule 55 challans, and ACL-protected full-text document search)
- **Dashboards, BI, Global Search, AI Copilot & Automations** (11 department KPI cards, report builder & schedules, company-wide search, AI Copilot & Holt statistical forecasts, automation rules, webhooks, and WhatsApp/SMS logs)
- **Go-Live Cut-Over, Hindi Language & DPDP Compliance** (opening-balance dry-run & dual sign-off, instant English/Hindi UI toggle, and DPDP Privacy Notice & 30-day data request register)
- **Installable App (PWA), Real-Time Alerts, Broadcasts & Email Automation** (Desktop/Android/iPhone Home Screen app, instant `< 2 s` top-bar bell & push notifications, company broadcast banners & acknowledgement modals, and automatic PDF/encrypted payslip emails)
- **A stronger base** (lists that open quickly with Next / Previous, one button bar on every screen, more warehouse / payroll / sales screens, and a Page Health screen for the Administrator)
- **Working in several plants** (choose one or more plants after login, a plant selector in the top bar, a Menu page with search and favourites, and a new Home page)
- **Dashboards with targets** (My Dashboard, Plant Dashboard with all your plants side by side, Owner Console, KPI targets with green / amber / red, alerts, a TV screen link and emailed dashboards)
- **Work moving between departments** (send a document to the next department with **Move Forward**, a Department Inbox with Received / Accepted / Return, a lock so only the department holding a document can edit it, and a Workflow Builder (Workflow Matrix) the Administrator controls)
- **Product development and order tracking** (Sales Enquiries, product development gates for new BLDC motors and SPPM machines with specifications, tests and a dossier PDF, a 360° Order Tracking screen with progress %, a Project History timeline, and a Process Exceptions list that finds delays by itself)
- **Documents and mail** (every record prints as PDF, Word or Excel, a Document Center, mail between departments, quality certificates, offer and appointment letters, and ready-made email automations the Administrator can switch on or off)
- **Attendance that runs by itself** (punches arrive from the machines automatically, each day is calculated at once, missed punches are reminded the next morning, late-mark and missed-punch rules apply with a clear reason that HR can reverse, overtime goes to the manager, a daily report for managers, the month locks by itself and feeds payroll, and a Live Board shows who is inside now)
- **Workplace operations** (tasks with dependencies and recurring tasks, shift handover, visitor management with approval and overstay alerts, and a canteen with scanning, cost and an automatic payroll deduction)
- **Contract labour** (contractors, work orders, workers with KYC / medical / safety checks, automatic daily muster from the machines, wage sheets, contractor bills checked against attendance, a compliance score that blocks payment, and safety incidents)
- **Admin control centre** (add your own fields to any form, make fields required or read-only by role and status, switch modules on or off per plant, sign-in hours and IP rules per role, live sessions with force logout, "View as" for the owner, API keys and a system health page)
- **External connections, switched off until you choose** (GST e-invoice IRN, WhatsApp, bank feed hooks, and signed outbound webhooks with a retry queue and a dead-letter queue; secrets are kept encrypted and shown masked)
- Your complete money and tax reports

I've written a simple step-by-step guide below, in the natural flow of your operations. Each step tells you which screen to open and what to try.

👉 **Before you start**
Open this page on your laptop or phone and log in with the Admin details we shared earlier:
🔗 https://erp.sawantgroup.co.in/login

⚠️ One small request: this is your real system, so please start every name you type with **TEST** (like "TEST Steel Rod", "TEST Employee", or "TEST Customer"). That way we can easily tell test entries apart later and clean them up.

If any screen says something is "waiting for approval", just open **My Approvals** (🔗 https://erp.sawantgroup.co.in/approvals) and approve it yourself, then carry on.

---

### PART 1: Buying material and checking its quality

**1. Add your items**
📍 Menu: Inventory ➜ **Item / SKU Master**
🔗 https://erp.sawantgroup.co.in/m/inv-items
✅ Add these items: one finished product (type: Finished Good), two raw materials, and one **Spare Part** (a small part for machine repairs, for example "TEST Belt"). On one raw material, tick **"Quality Inspection Required"**.

**2. Put some stock in**
📍 Menu: Inventory ➜ **Opening Stock**
🔗 https://erp.sawantgroup.co.in/m/inv-opening
✅ Enter a starting quantity and cost for the two raw materials and for the spare part, then save and post. Then look at **Stock Balance** (🔗 https://erp.sawantgroup.co.in/m/inv-stock) to see the quantities.

**3. Tell the system how to check that material**
📍 Menu: Quality ➜ **Inspection Plans**
🔗 https://erp.sawantgroup.co.in/m/qms-plans
✅ Add a plan for the material you ticked in step 1. Add one measurement with a lowest and highest allowed value (for example 9.5 to 10.5), and one simple OK / Not OK check.

**4. Buy the material**
📍 Menu: Procurement ➜ **Supplier Master**, then **Purchase Orders**
🔗 https://erp.sawantgroup.co.in/m/scm-suppliers
🔗 https://erp.sawantgroup.co.in/m/scm-po
✅ Add a TEST supplier, then create a purchase order to that supplier for the material that needs a quality check.

**5. Receive the material**
📍 Menu: Procurement ➜ **Goods Receipt / GRN**
🔗 https://erp.sawantgroup.co.in/m/scm-grn
✅ Receive the purchase order you just made. Then check **Stock Balance**: that material should show as "waiting for quality check", not yet usable.

**6. Do the quality check**
📍 Menu: Quality ➜ **Incoming Quality**
🔗 https://erp.sawantgroup.co.in/m/qms-incoming
✅ A new inspection sheet is already waiting there, filled in for you. Open it and type a reading. Try one outside the allowed range and watch it turn red and refuse to be marked "accepted". Then fix it, submit, and record the decision (how many accepted, how many rejected). Back in **Stock Balance**, accepted pieces become usable and rejected ones are locked.

---

### PART 2: Making your product

**7. Set up your machines or stations**
📍 Menu: Manufacturing ➜ **Work Centers**
🔗 https://erp.sawantgroup.co.in/m/mfg-workcenters
✅ Add two, for example "TEST Cutting" and "TEST Assembly". For each one fill in the **labour cost per hour**, the **overhead cost per hour** and choose a **cost center**. (The system will not let you start an order without these, because the cost of the product is worked out from them.) Look at the other tabs too: **Calendars**, **Downtime reasons** and **Scrap reasons**.

**8. Say what the product is made of**
📍 Menu: Manufacturing ➜ **Bill of Material**
🔗 https://erp.sawantgroup.co.in/m/mfg-bom
✅ Click New, choose your finished product, add the two raw materials with the quantity needed for one piece (and a small waste percentage if you like), and save as a draft. Click **Send for approval**, then **Release**. Once released, the BOM is locked: try to change it and you'll be offered **New revision** instead. Click **Show tree** to see the product's parts as a tree.

**9. Say how it is made, step by step**
📍 Menu: Manufacturing ➜ **Routing**
🔗 https://erp.sawantgroup.co.in/m/mfg-routing
✅ Add two steps: Cutting, then Assembly. Give each step the minutes it takes. Save, then **Release**.

**10. Plan what to make**
📍 Menu: Manufacturing ➜ **Production Planning**
🔗 https://erp.sawantgroup.co.in/m/mfg-plan
✅ Click **+ New plan**, add your finished product with a quantity and a date. Open the plan and press **Check capacity** and **Check material**: they tell you whether your machines and your stock can cope. Then **Release plan**. The other tabs show the **Daily board** and **Capacity**.

**11. See what to make and what to buy**
📍 Menu: Manufacturing ➜ **Material Requirement Planning**
🔗 https://erp.sawantgroup.co.in/m/mfg-mrp
✅ Click **Run MRP**. When it is done, open the run: every line says **Make** or **Buy**, and the "Why" column shows which order or plan needs it. Press **Firm** on one, then **Convert**: a "Make" becomes a draft production order, and a "Buy" becomes one purchase requisition.

**12. Start a production order**
📍 Menu: Manufacturing ➜ **Production Orders**
🔗 https://erp.sawantgroup.co.in/m/mfg-orders
✅ Click New, choose the product and a quantity (say 10), pick your stores, and save. You'll see how much material is needed, waste included. Click **Release** (a big order may wait for approval first). Then enter quantities under **Issue material** and press the button. Check Stock Balance: the material has gone down. Try issuing a lot more than needed and see what the system says.

**13. Do the work on job cards**
📍 Menu: Manufacturing ➜ **Work Orders (Job Cards)**
🔗 https://erp.sawantgroup.co.in/m/mfg-workorders
✅ Open the first card. Press **Start setup**, then **Start run**. Enter the **good pieces**, the **rejected** and the **scrap** (choose a reason) and press **Complete this card**. The second card now opens. Try **Pause** and choose why you stopped. You can also **Print job card**: it has a small square code on it.

**14. Use the tablet screen on the shop floor**
📍 Menu: Manufacturing ➜ **Shop Floor**
🔗 https://erp.sawantgroup.co.in/m/mfg-shopfloor
✅ On a tablet or phone: pick your work center, tap a card and use the big buttons. Try **Machine stopped** and **Machine running again**. The second tab, **Supervisor dashboard**, shows the day's output, the machine efficiency (OEE) and overdue orders. If nothing was logged today it simply says "No data yet".

**15. Scrap and rework**
📍 Menu: Manufacturing ➜ **Scrap Management**, then **Rework Management**
🔗 https://erp.sawantgroup.co.in/m/mfg-scrap
🔗 https://erp.sawantgroup.co.in/m/mfg-rework
✅ Scrap from the job cards appears as drafts: press **Submit**. The loss goes to the books as scrap loss. In Rework, finish a rework job and enter the hours and extra material it needed.

**16. Bring finished products into stock and close the order**
📍 Menu: Manufacturing ➜ **Finished Goods Receipt**
🔗 https://erp.sawantgroup.co.in/m/mfg-fg
✅ Open the order and receive a part of the pieces, then the rest. (If the product needs quality inspection, the pieces wait in "quality hold" until the decision in Quality ➜ **Final Quality**, 🔗 https://erp.sawantgroup.co.in/m/qms-final.) Back in **Production Orders**, press **Work is finished**, then **Close order**.

**17. See the money side of production**
📍 Menu: Manufacturing ➜ **WIP Tracking**
🔗 https://erp.sawantgroup.co.in/m/mfg-wip
✅ Orders still in production and the value they hold. At the top it says whether this agrees with the books ("Matches"). After you close your order it should disappear from the list.
📍 Menu: Manufacturing ➜ **Production Costing**
🔗 https://erp.sawantgroup.co.in/m/mfg-costing
✅ Material, labour, overhead and the cost per piece. Open **Cost sheet** for one order, and look at the **Variances** and **Yield** tabs.

---

### PART 3: Keeping machines running and looking after assets

**18. Add a machine**
📍 Menu: Maintenance ➜ **Machine Master**
🔗 https://erp.sawantgroup.co.in/m/maint-machines
✅ Click **+ New machine**, choose the category "Plant and machinery (general)", fill in make, location and how critical it is (A is most important), and tick "Needs maintenance". It starts as "CWIP" (not yet in use). Open it later to see its health, how often it fails and how long repairs take.
📍 You can also add parts of a machine (for example a motor) under **Equipment Master**: 🔗 https://erp.sawantgroup.co.in/m/maint-equipment

**19. Put the asset to work: capitalise it**
📍 Menu: Assets ➜ **Capitalisation**
🔗 https://erp.sawantgroup.co.in/m/asset-capitalization
✅ Click **+ New capitalisation**, choose your machine, the date it is ready to use, and the costs: price (with the GST on it), freight, installation. Choose the account each cost is booked against. Save, **Send for approval**, **Approve**, **Post**. Note that GST you can claim back is *not* added to the machine's cost. Then look at **Asset Master** (🔗 https://erp.sawantgroup.co.in/m/asset-master): your machine is now Active with its cost and book value.

**20. Meters and service plans**
📍 Open your machine ➜ **Add meter** (running hours), type a reading
📍 Menu: Maintenance ➜ **Preventive Maintenance**
🔗 https://erp.sawantgroup.co.in/m/maint-preventive
✅ On the **Checklists** tab make a small checklist ("Lubricate", "Spindle temperature 20 to 60"). Then on **PM plans** make a plan: for example every 30 days. Open **Maintenance Schedule** (🔗 https://erp.sawantgroup.co.in/m/maint-schedule) and press **Raise due work orders now**. A service job appears.

**21. Do the service job**
📍 Menu: Maintenance ➜ **Maintenance Work Orders**
🔗 https://erp.sawantgroup.co.in/m/maint-workorders
✅ Open the job, press **Start the job**, fill in the checks (a temperature outside the limits is refused), add a spare part, **Issue** one from the store and see its cost, then **Job is done** and **Sign off and close**. Check **Stock Balance**: the spare part has gone down.

**22. A machine breaks down**
📍 Menu: Maintenance ➜ **Breakdown Log**
🔗 https://erp.sawantgroup.co.in/m/maint-breakdown
✅ Click **+ Report a breakdown**, pick the machine and describe the problem. Open it: **Acknowledge** (this makes the repair job), **Start repair**, **Repaired** (choose how, why and what failed), complete the repair job, then **Close ticket**. Now see **Downtime** (🔗 https://erp.sawantgroup.co.in/m/maint-downtime) for the stop, and **MTBF and MTTR** (🔗 https://erp.sawantgroup.co.in/m/maint-mtbf) for how reliable the machine is. A machine with no failures shows a dash, not a made-up number.

**23. Alerts and spares**
📍 Menu: Maintenance ➜ **Maintenance Alerts** (🔗 https://erp.sawantgroup.co.in/m/maint-alerts) — press **Check now**: services due, overdue ones, unanswered breakdowns, warranties ending.
📍 Menu: Maintenance ➜ **Spare Parts** (🔗 https://erp.sawantgroup.co.in/m/maint-spares) — your spare part items with the stock you hold.

**24. Depreciation: how the asset loses value**
📍 Menu: Assets ➜ **Depreciation**
🔗 https://erp.sawantgroup.co.in/m/asset-depreciation
✅ First open **Asset Master ➜ Categories and lives**: the useful lives are filled in from the Companies Act (Schedule II) and marked "To review". Check them and press **Set life** to confirm one. Then **+ New run** for a month that has finished: check the amount for each asset, then **Post**. Press **Reverse** to undo it. A second run for **Income tax** shows the income-tax method for each block (this one only calculates, it does not touch your books). On the **Extra shifts** tab you can say a machine ran two or three shifts for some days, and its depreciation goes up.

**25. Hand over, move and dispose of assets**
📍 Menu: Assets ➜ **Asset Allocation** (🔗 https://erp.sawantgroup.co.in/m/asset-allocation) — give an asset to a person and take it back.
📍 Menu: Assets ➜ **Asset Transfer** (🔗 https://erp.sawantgroup.co.in/m/asset-transfer) — move an asset to another place or unit. Moving it to another unit posts both units' books.
📍 Menu: Assets ➜ **Asset Disposal** (🔗 https://erp.sawantgroup.co.in/m/asset-disposal) — sell an asset with GST: the profit or loss is worked out for you.

**26. Labels and counting**
📍 Menu: Assets ➜ **QR and Verification**
🔗 https://erp.sawantgroup.co.in/m/asset-qr
✅ Tick some assets and print their QR labels. On the **Scan** tab type a label's code to find the asset. On **Physical verification** start a count and mark each asset Found or Missing.

---

### PART 4: Selling

**27. Add a lead and move it forward**
📍 Menu: CRM ➜ **Lead Management**, then **Sales Pipeline**
🔗 https://erp.sawantgroup.co.in/m/crm-leads
🔗 https://erp.sawantgroup.co.in/m/crm-pipeline
✅ Add a TEST lead, then drag or move it forward step by step in the pipeline.

**28. Take an order and send the goods**
📍 Menu: Sales ➜ **Sales Orders**, then **Dispatch**
🔗 https://erp.sawantgroup.co.in/m/sales-orders
🔗 https://erp.sawantgroup.co.in/m/sales-dispatch
✅ Create an order for your finished product, approve it, then dispatch it. You can print the delivery challan from the dispatch.

**29. Invoice and collect payment**
📍 Menu: Sales ➜ **Invoices**, then **Collections**
🔗 https://erp.sawantgroup.co.in/m/sales-invoices
🔗 https://erp.sawantgroup.co.in/m/sales-collections
✅ Make the invoice for that dispatch and check the total and tax look right. Then record a payment against it and see the balance change.

---

### PART 5: Managing your team (HRMS)

**30. Add an employee & verify identity**
📍 Menu: HRMS ➜ **Employee Master**
🔗 https://erp.sawantgroup.co.in/m/hr-employees
✅ Click **+ Add Employee**. Fill in their basic profile (name, department, designation, date of joining). Try typing an invalid 12-digit Aadhaar number: the built-in Verhoeff checksum algorithm will catch typos and highlight it in red. Type a valid 12-digit number (e.g. `999999990019`) and an IFSC code (e.g. `HDFC0001234`): the system encrypts them safely in a secure vault and shows clean masked numbers (`XXXX-XXXX-0019`).

**31. Check attendance & biometric punches**
📍 Menu: HRMS ➜ **Time & Attendance**
🔗 https://erp.sawantgroup.co.in/m/hr-attendance
✅ View daily punch logs with In/Out timestamps. See how the engine calculates exact worked hours, compares them against the standard General Shift (09:00 to 18:00), applies the 15-minute grace period, and flags overtime or late arrivals.

**32. Apply for leaves & the Sandwich Rule**
📍 Menu: HRMS ➜ **Leave Management**
🔗 https://erp.sawantgroup.co.in/m/hr-leave
✅ Submit a leave request (Casual Leave or Earned Leave). Try booking a leave across a weekend (Friday to Monday): notice how the system's Sandwich Rule automatically detects whether the Sunday off-day counts as leave or regular weekly off based on your company policy. Managers can approve or reject leaves with one click.

**33. Travel & expense claims**
📍 Menu: HRMS ➜ **Expense Claims**
🔗 https://erp.sawantgroup.co.in/m/hr-expense
✅ File a travel or petty expense claim (lodging, meals, fuel). Enter bill dates, amounts, and attach receipts. Once approved by the supervisor, the finance department can reimburse it directly.

**34. Employee Self-Service (ESS)**
📍 Menu: HRMS ➜ **Self-Service Portal**
🔗 https://erp.sawantgroup.co.in/m/hr-ess
✅ Open this screen on your mobile phone: employees can view their personal attendance calendar, leave balance badges, download recent documents, and raise helpdesk requests on the go.

---

### PART 6: Running payroll & paying salaries

**35. Salary structures & Code on Wages (50% Rule)**
📍 Menu: Payroll ➜ **Salary Structure**
🔗 https://erp.sawantgroup.co.in/m/pay-structure
✅ Check your company's pay components: Basic, HRA, Conveyance, Special Allowance. Test the **Code on Wages 50% Add-Back Rule**: if allowances exceed 50% of the total CTC, the system automatically adds back the difference into the statutory wage so your PF and gratuity calculations stay fully compliant with law.

**36. Calculate & process monthly payroll**
📍 Menu: Payroll ➜ **Pay Processing**
🔗 https://erp.sawantgroup.co.in/m/pay-processing
✅ Pick a salary month and press **Run Payroll Calculation**. The engine works out the exact figures for all staff:
- Prorates Basic for any unpaid loss-of-pay days
- Deducts Employee PF (12% capped at the statutory ₹15,000 ceiling, with EPS ₹1,250 split)
- Calculates ESIC (0.75% employee, 3.25% employer for wages under ₹21,000)
- Applies Maharashtra Professional Tax (PT: ₹200/month, ₹300 in February; exempt for women earning up to ₹25,000)
- Projects and deducts monthly Income Tax (TDS) under the New Tax Regime

**37. Check statutory schedules**
📍 Menu: Payroll ➜ **Statutory Reports**
🔗 https://erp.sawantgroup.co.in/m/pay-pf
✅ Open the statutory tabs: PF ECR summary, ESIC monthly return table, and PT Maharashtra register. All figures match your monthly gross earnings and headcount.

**38. Post payroll to your accounts**
📍 In **Pay Processing**, click **Approve & Post to Accounts**.
✅ A balanced journal entry is created in your general ledger:
- Dr Salaries & Wages Expense
- Dr Employer PF & ESIC Contribution
- Dr Bonus & Gratuity Provisions
- Cr Net Salaries Payable
- Cr PF, ESIC, PT, and TDS Statutory Payables

**39. View payslips & bank transfer advice**
📍 Menu: Payroll ➜ **Payslips** (🔗 https://erp.sawantgroup.co.in/m/pay-payslip) — open any employee's payslip to see earnings, deductions, and the net pay written out in Indian currency words (e.g. *"Rupees Fourteen Thousand Five Hundred Only"*).
📍 Menu: Payroll ➜ **Bank Payment Advice** (🔗 https://erp.sawantgroup.co.in/m/pay-bank) — download the ready-to-upload bank NEFT/RTGS salary payout file.

---

### PART 7: Customer projects

**40. Create a project & approve its budget**
📍 Menu: Projects ➜ **Project Master**
🔗 https://erp.sawantgroup.co.in/m/proj-projects
✅ Click **+ New Project** (e.g. "TEST Turnkey Automation"). Enter customer name, start date, and target end date. Then add a **Budget** broken down into labour, materials, and overheads. Note: the system will strictly prevent starting the project until the budget is approved (**PRJ_BUDGET_NONE**), ensuring no unbudgeted work begins.

**41. Interactive Gantt chart & Critical Path**
📍 Menu: Projects ➜ **Gantt Chart**
🔗 https://erp.sawantgroup.co.in/m/proj-gantt
✅ See your project schedule rendered as interactive visual timeline bars. The built-in Critical Path Method (CPM) calculates early and late dates, floats, and highlights the **Critical Path in bright red**. If any team member adds a circular dependency that causes an infinite loop, the system immediately catches it (`PRJ_DEP_CYCLE`). Compare your actual timeline against the ghost baseline bars to see delays instantly.

**42. Project Kanban board**
📍 Menu: Projects ➜ **Kanban Board**
🔗 https://erp.sawantgroup.co.in/m/proj-kanban
✅ Move tasks through stages: *Backlog ➜ In Progress ➜ Review ➜ Done*. Each column displays Work-In-Progress (WIP) limit warnings if tasks pile up in review.

**43. Weekly timesheets & labour cost absorption**
📍 Menu: Projects ➜ **Timesheets**
🔗 https://erp.sawantgroup.co.in/m/proj-timesheets
✅ Log hours spent by your engineers against specific project tasks. Try typing more than 24 hours in a single calendar day: the system blocks it (`TS_DAY_HRS`). When the project manager clicks **Approve**, the engineer's hourly cost is frozen and automatically posted to the general ledger (**Dr 5112 Project Labour Cost / Cr 5113 Labour Cost Absorbed**), so your project cost is always accurate to the minute.

**44. EVM health & project profitability**
📍 Menu: Projects ➜ **Project Profitability**
🔗 https://erp.sawantgroup.co.in/m/proj-profitability
✅ Open this drill-down screen to see real financial performance drawn directly from your accounting entries:
- **Earned Value Management (EVM):** See Cost Performance Index (CPI), Schedule Performance Index (SPI), Estimate at Completion (EAC), and the overall health badge (**GREEN / AMBER / RED**).
- **GL P&L Drill-Down:** Total billed revenue vs actual labour, material, and travel expenses booked against this project.

---

### PART 8: After-sales service, AMCs & warranties

**45. Service desk & live SLA countdown**
📍 Menu: Service ➜ **Service Desk**
🔗 https://erp.sawantgroup.co.in/m/service-tickets
✅ Click **+ New Ticket** for a customer issue. Priority is automatically assigned (P1 Critical to P4 Low) and clamped to the customer's SLA contract tier. The live SLA timer counts down strictly during business hours (09:00 to 18:00 IST), automatically pauses on weekends and gazetted holidays, and triggers an **amber warning at 75% elapsed time** so no customer is left waiting.

**46. Smart technician auto-dispatch**
📍 Menu: Service ➜ **Technician Board**
🔗 https://erp.sawantgroup.co.in/m/service-technicians
✅ View your technicians, their skill certifications, and current job load. Click **Auto-Dispatch**: the algorithm scores candidates based on:
$$\text{Score} = 50\% \times \text{Skill Match} + 30\% \times \text{Available Capacity} + 20\% \times \text{Territory Proximity}$$
Technicians on leave are automatically bypassed, and the best-matching technician is assigned in seconds.

**47. Mobile field visit with customer signature**
📍 Menu: Service ➜ **Mobile Visits**
🔗 https://erp.sawantgroup.co.in/m/service-visits
✅ Open this on a technician's mobile phone. It features a clean 5-step stepper:
1. **Start Travel**
2. **GPS Check-In** at the customer site
3. Complete the on-site checklist
4. **Issue & consume spare parts** from van stock (the system ensures consumed parts cannot exceed issued stock, and updates accounting: **Dr 6218 Warranty Service Cost / Cr 1401 Inventory**)
5. **Customer Signature**: have the customer sign directly on the touchscreen canvas, tap **Complete**, and download the signed service report.

**48. Annual Maintenance Contracts (AMC)**
📍 Menu: Service ➜ **AMC Contracts**
🔗 https://erp.sawantgroup.co.in/m/service-amc
✅ Create a 1-year Comprehensive or Non-Comprehensive AMC. The system automatically creates:
- The preventive visit schedule (e.g. quarterly visits)
- The customer billing schedule
- **Daily Straight-Line Revenue Recognition (Ind AS 115 / AS 9)**: click *Recognize Monthly Revenue* to post the earned revenue (**Dr 2402 AMC Deferred Revenue / Cr 4110 AMC Revenue**), ensuring zero leftover deferred balance when the contract concludes.

**49. Serial warranty lookup & supplier claims**
📍 Menu: Service ➜ **Warranty & Claims**
🔗 https://erp.sawantgroup.co.in/m/service-warranty
✅ Type the serial number of a sold machine. The system checks whether it is under active warranty, covered by an AMC, or out of warranty (with exact $\pm 1$ day boundary checks). If a defective vendor component caused the breakdown, click **Raise Supplier Claim**: upon approval, the system settles it directly (**Dr 1205 Supplier Claims Receivable / Cr 4205 Warranty Claim Recovery**).

---

### PART 9: Logistics, Fleet, Gate Security & Document Vault (Phase 18)

**50. Shipments, Freight Slabs & Containers**
📍 Menu: Logistics ➜ **Shipments** (🔗 https://erp.sawantgroup.co.in/m/log-shipments) & **Freight Calculator** (🔗 https://erp.sawantgroup.co.in/m/log-freight)
✅ Create a transporter rate card with weight slabs, then run a freight calculation (e.g. `2,350 kg`) to inspect base freight, fuel surcharge, toll, loading, and **5% RCM GST** breakdown. Drag a shipment card across Kanban stages, add tracking events, upload a **Proof of Delivery (POD)** at https://erp.sawantgroup.co.in/m/log-pod, and test ISO 6346 container number check-digit validation at https://erp.sawantgroup.co.in/m/container-track.

**51. Fleet Compliance, Drivers & Full-Tank Fuel Logs**
📍 Menu: Fleet ➜ **Vehicles** (🔗 https://erp.sawantgroup.co.in/m/fleet-vehicles) & **Fuel Logs** (🔗 https://erp.sawantgroup.co.in/m/fleet-fuel)
✅ Open a company vehicle to check colour-coded statutory badges (`RC`, `Insurance`, `PUC`, `Fitness`, `Permit`). Try recording a **Full-Tank Fuel Log** with an odometer drop or an abnormal km/litre jump — the system immediately flags fuel anomalies. Check drivers and maintenance jobs at https://erp.sawantgroup.co.in/m/fleet-drivers and https://erp.sawantgroup.co.in/m/fleet-service.

**52. Security Guard Tablet Gate Kiosk (Inward & Outward)**
📍 Direct Kiosk URL: 🔗 https://erp.sawantgroup.co.in/gate/kiosk (or Menu: Logistics ➜ **Gate IN** `https://erp.sawantgroup.co.in/m/gate-in`, **Gate OUT** `https://erp.sawantgroup.co.in/m/gate-out`, **Material Return** `https://erp.sawantgroup.co.in/m/gate-return`)
✅ Notice the oversized `>= 64px` buttons built for tablet guards, with **all currency/money fields hidden** from gate staff:
- **Vehicle IN:** Pick a TEST supplier to see only open POs for your current unit, capture photo/entry time, and watch a matching **Draft GRN** pre-fill automatically.
- **Vehicle OUT (E-Way Bill Check):** Enter an E-Way Bill whose Part B vehicle number does not match the gate vehicle — a red banner immediately blocks exit.
- **Returnable Gate Pass (CGST Rule 55):** Issue a returnable challan (strict `<= 16` character pass number) and record a partial material return (e.g. `6 of 10`): `balance_qty` updates live to `4`, and over-return is refused.

**53. Document Management Vault (DMS) & Permission-Safe Search**
📍 Menu: Documents ➜ **Folders & Vault** (🔗 https://erp.sawantgroup.co.in/m/dms-docs) & **Full-Text Search** (🔗 https://erp.sawantgroup.co.in/m/dms-search)
✅ Upload a document into an internal folder, try **Check-Out / Check-In** version control, test **Legal Hold** (prevents retention disposal), and generate an expiring **Share Link**. Put a confidential test file inside a Restricted folder without granting a lower-privilege user access: searching its exact title from that user's login returns empty results.

---

### PART 10: Executive Dashboards, BI, Global Search, AI Copilot & Automations (Phase 19)

**54. Executive Command Center & Live Department KPIs**
📍 Menu: Executive ➜ **Command Center** (🔗 https://erp.sawantgroup.co.in/m/command-center)
✅ Inspect live KPI cards pulled directly from posted ledger/inventory/HR data. Hover or click the **`i` info icon** on any KPI card to verify its exact accounting/operational formula and source row count. When a denominator is zero, the card shows **`—` / `No data in period`** instead of misleading numbers.

**55. Self-Service BI Report Builder & Scheduled Reports**
📍 Menu: Executive ➜ **BI Builder** (🔗 https://erp.sawantgroup.co.in/m/bi-builder) & **Report Schedules** (🔗 https://erp.sawantgroup.co.in/m/bi-scheduler)
✅ Pick any governed dataset (`sales_orders_v`, `invoices_v`, `po_lines_v`, `stock_balance_v`, etc.), apply filters, and preview live results (strictly scoped to your active unit). Notice sensitive fields like PAN, mobile, and net pay are masked cleanly.

**56. Company-Wide Global Search (Unit-Scoped)**
📍 Menu: Executive ➜ **Global Search** (🔗 https://erp.sawantgroup.co.in/m/global-search)
✅ Search for any customer, supplier, invoice number, PO, SKU, employee code, or ticket from one box. Verify that a `TAL`-only user searching a `SAW`-exclusive invoice sees **0 results**, while an Administrator sees the match.

**57. AI Copilot & Statistical Demand Forecasts**
📍 Menu: Executive ➜ **AI Copilot** (🔗 https://erp.sawantgroup.co.in/m/ai-copilot) & **Forecasts** (🔗 https://erp.sawantgroup.co.in/m/ai-demand)
✅ Ask a business question in plain English — the Copilot uses read-only tools, quotes verifiable record badges, and tracks daily token/INR limits. Run a statistical demand forecast and inspect the **`Estimate · Holt`** chart with its **`± 1.96 × RMSE`** confidence band. (If the Admin toggle for AI is switched off, the panel cleanly states *"AI is off"*.)

**58. Safe Automations, Webhooks & WhatsApp / SMS Logs**
📍 Menu: Automation ➜ **Rules** (🔗 https://erp.sawantgroup.co.in/m/auto-rules), **Webhooks** (🔗 https://erp.sawantgroup.co.in/m/auto-webhooks), **Communication Center** (🔗 https://erp.sawantgroup.co.in/m/comm-templates & `https://erp.sawantgroup.co.in/m/comm-logs`)
✅ Test rule condition trees and loop protection. On **Webhooks**, try adding an internal private IP like `http://192.168.1.5` — our SSRF guard refuses non-public HTTPS URLs immediately. Check **Communication Logs** to inspect rendered outbound messages, consent statuses, and payment short-links.

---

### PART 11: Go-Live Cut-Over, Hindi Language & DPDP Privacy (Phase 20)

**59. Opening-Balance Cut-Over & Dual Sign-Off**
📍 Menu: Administration ➜ **Go-Live Hardening & Cut-Over** (🔗 https://erp.sawantgroup.co.in/hardening) & **Audit Partitions** (🔗 https://erp.sawantgroup.co.in/m/admin-backup)
✅ Upload or enter a sample `GL_TRIAL` opening balance batch and run **Dry Run** — if debits equal credits (`0` difference), run **Commit** and record **CFO + Department Head Dual Sign-Off**. Switch to the **Audit Partitions** tab to confirm monthly `audit_logs` partitions with `0` unrouted rows.

**60. Instant Hindi UI & Indian Formatting (`en-IN`)**
📍 Look at the **Language Switcher (`EN / हि`)** in the top navigation bar (and **Preferences**).
✅ Toggle to **हिन्दी (Hindi)** — labels across menus, buttons, and messages switch immediately and persist across page reloads, while Rupee amounts (`₹ 1,25,000.00`) and dates (`DD-MM-YYYY`) follow Indian standards throughout.

**61. DPDP Privacy Notice & 30-Day Request Register**
📍 Footer link: **Privacy Notice** (at the bottom of any screen) & Hardening ➜ **DPDP Register** (🔗 https://erp.sawantgroup.co.in/hardening)
✅ Open the **Privacy Notice** modal in English, Hindi, or Marathi. Then open **DPDP Register** to log a test data access/correction/erasure request and see the automatic **30-day statutory SLA** due date.

---

### PART 12: Installable App (PWA), Real-Time Alerts, Broadcasts & Email Automation (Phase 21)

**62. Install as a Desktop or Mobile App (PWA)**
📍 URL: 🔗 https://erp.sawantgroup.co.in/install (or click **My Account** drawer ➜ **Install App**)
✅ Install **Sawant Group ERP** from Chrome/Edge on Desktop or Android (or Safari ➜ *Share ➜ Add to Home Screen* on iPhone/iPad). Notice Home Screen / Taskbar shortcuts (*My Approvals*, *Notifications*, *Scan QR*, *New Gate Entry*). Turn off Wi-Fi briefly and refresh: an offline screen confirms *"You are offline — data needs the network"* so stale financial or stock data is never shown.

**63. Real-Time Top-Bar Bell (`< 2 s`) & Browser Push Notifications**
📍 Notification Bell (top bar) ➜ **View all** (🔗 https://erp.sawantgroup.co.in/m/notif-center) & **Preferences** (🔗 https://erp.sawantgroup.co.in/m/notif-preferences), Administration ➜ **Notification Types** (🔗 https://erp.sawantgroup.co.in/m/admin-notif-types)
✅ Open two browser tabs (or two logins). Trigger a test notification from **Notification Types** (`Send Test`):
- Watch the red badge count on the Bell update in **under 2 seconds** via live SSE (`All / Approvals / Alerts / Announcements` tabs).
- On **Notification Preferences**, click **Enable push notifications** to register your browser, set **Quiet Hours (IST)** (non-urgent push waits until quiet hours end; `URGENT` alerts break through immediately), and confirm `🔒 Always` prevents turning off mandatory Approval / Security alerts.

**64. Admin Broadcast Announcements & Blocking Acknowledgements**
📍 Menu: Administration ➜ **Broadcast Announcements** (🔗 https://erp.sawantgroup.co.in/m/admin-notif-broadcast)
✅ Draft a test broadcast targeting a single unit (`TAL`), click **Preview Audience** (*"This will reach N active users"*), tick **Pin Banner** and **Require Ack Modal**, and send:
- Verify users in the target unit see the pinned banner immediately and get the blocking modal (**"I have read this"**) until acknowledged, while users in other units (`SAW`) do not receive it.
- Try submitting a `CRITICAL` broadcast: it waits in **Pending Approval** for a `Director+` other than the creator (self-approval is blocked). Test **Withdraw** to remove an active banner cleanly.

**65. Automated Document Emails, 7 MB Share Link Cutoff & Encrypted Payslips**
📍 Menu: Sales ➜ **Invoices** (open any **Posted** invoice and click **Email**), Administration ➜ **Email Automation Rules** (🔗 https://erp.sawantgroup.co.in/m/admin-email-rules), **Communication Logs** (🔗 https://erp.sawantgroup.co.in/m/comm-logs), and **Notification & Email Health** (🔗 https://erp.sawantgroup.co.in/m/admin-notif-health)
✅ Click **Email** on a Posted Sales Invoice to preview To/CC, attachment mode (**Auto**: attaches PDF if `<= 7 MB`, else generates a 30-day DMS share link), and send. Check **Email Suppressions** (🔗 https://erp.sawantgroup.co.in/m/admin-email-suppressions) for blocked bounced addresses and try **Resend** (with mandatory audit reason) on **Communication Logs**. On released payslips, downloaded/emailed PDFs are **AES-256 password protected** (`first 4 letters of PAN in CAPITALS + DDMM of DOB`, or `EMP_CODE + DDMM` if PAN is absent — and the email body never prints the actual password).

---

### PART 12B: A stronger base — paging, one button bar, more screens, Page Health (Phase 22)

**Employee**
**A. Lists open quickly, with Next / Previous**
📍 Menu: Warehouse ➜ **Warehouse Transfers**, Payroll ➜ **Loans / Advances**, Sales ➜ **Price Lists**
✅ The list opens in about 1 second and shows up to 25 rows. Press **Next** and **Previous**; the line under the table says "Showing 26–50 of …". If the list has more than 10,000 rows it says "10,000+".

**B. A grey button tells you why**
📍 Open any row of the screens above, then look at the button bar at the top.
✅ Buttons you may not use are not shown. Buttons that do not fit this record are grey. Hover over a grey button: **Edit** on a posted record says "Posted documents can't be edited — use Cancel/Reverse."; **Word** says "Arrives in Phase 27." (Move Forward is now working: see Part 12E.)

**Store / Warehouse**
**C. Zones, Racks and Shelves**
📍 Menu: Warehouse ➜ **Zone Management** ➜ **＋ Add** (choose the warehouse, Zone Code Z-A, name "Zone A") ➜ Save. Then Warehouse ➜ **Rack Management** ➜ ＋ Add (choose the zone, Rack Code R-01) and Warehouse ➜ **Shelf Management** ➜ ＋ Add (choose the rack, Shelf Code S-01).
✅ Each one appears in its list with its parents (rack shows its zone and warehouse; shelf shows its rack). Try the same code twice: you get "This one already exists". Try to delete a zone that still has racks: it explains why not.

**D. Put a bin on a shelf**
📍 Warehouse ➜ **Shelf Management** ➜ click the shelf ➜ "Place a bin on this shelf" ➜ choose a bin ➜ Place bin.
✅ The bin is listed under "Bins on this shelf" and the Shelves list counts it. Warehouse ➜ **RFID Support** ➜ ＋ Add: the same bin is offered in the "Expected Location" list.

**E. Pick List, Packing, RFID tags**
📍 Warehouse ➜ **Pick List** ➜ ＋ Add (warehouse, date, then ＋ Add Line: item, source bin, quantity) ➜ Save. Warehouse ➜ **Packing** ➜ ＋ Add. Warehouse ➜ **RFID Support** ➜ ＋ Add (a tag code and the bin it is stuck on).
✅ A numbered wave appears with its tasks in the side panel. A wave that is Released can no longer be edited (hover Edit to see why).

**HR**
**F. Loans / Advances**
📍 Menu: Payroll ➜ **Loans / Advances** ➜ ＋ Add (employee, Principal 20000, Tenure 10, Disbursement Date)
✅ A numbered loan appears. Click it: the **EMI Schedule** lists 10 rows of ₹ 2,000.00. The loan cannot be edited or deleted afterwards (hover the grey buttons).

**Administrator**
**G. Page Health**
📍 Menu: Administration ➜ **Page Health** (🔗 https://erp.sawantgroup.co.in/m/admin-page-health)
✅ After the checker has run, tick **Only errors**. A fully healthy system shows "all green" and no rows. A slow page shows its load time in red.

**H. Page Registry**
📍 Menu: Administration ➜ **Page Registry** (🔗 https://erp.sawantgroup.co.in/m/admin-registry)
✅ Search for "rack". Click a page to see its tabs, fields and buttons, and whether it is **Built**, **Planned** (with the phase that brings it) or **Changed on purpose**.

---

### PART 12C: Working in several plants, the Menu and the new Home page (Phase 23)

**Administrator**
**A. Give a user more than one plant**
📍 Menu: Administration ➜ **Users** ➜ open a TEST user ➜ tick **Talwade** and **Sawardari**, choose **Talwade** as the default plant ➜ Save.
✅ A line under the plants reads "Can work in Talwade and Sawardari. Default: Talwade." You can also tick **All plants (including future plants)** for a person who should always see every plant, such as the Owner.

**Any user with more than one plant**
**B. Choose your plants after login**
📍 Sign in as that TEST user.
✅ A **Choose your plants** screen shows only the plants you were given. Tick both and press **Continue**. (Tick **Remember my choice** if you do not want to be asked again.)

**C. Change plants any time from the top bar**
📍 The plant box in the top bar ➜ tick or untick plants ➜ **Apply**.
✅ The lists and numbers change to those plants at once. If you have half-typed a form, the system asks before throwing it away.

**D. See the Plant column and pick the plant for a new record**
📍 Open any register, for example Sales ➜ **Sales Orders**, with two plants chosen.
✅ A **Plant** column appears and the list shows the combined data of both plants. Press **Add**: the form has a required **Plant** field that offers only the plants you chose. With one plant chosen, the column and the field are hidden.

**E. Access changes show up immediately**
📍 While the TEST user is signed in, the Administrator removes one plant from that user.
✅ The user sees "Your access to … was changed by Admin" and the lists update by themselves. The user can no longer open that plant's data (the system answers "You don't have access to …").

**F. The Menu page, search and favourites**
📍 Press **☰ Menu** in the top bar (or press Ctrl+K to search).
✅ Every area appears as a card. Type "grn" in the search box and the matching pages appear. Press the ⭐ next to a page: it is now listed under **Favourites** and on your Home page. Pages you opened recently are listed too.

**G. The new Home page**
📍 Click the logo at the top left (or open 🔗 https://erp.sawantgroup.co.in/home).
✅ You see your work strip (To Receive, To Accept, In Work, Returned, My Approvals, Overdue), quick-create buttons, your shortcuts and recent pages.

---

### PART 12D: Dashboards, targets, alerts and the TV screen (Phase 24)

**Manager**
**A. Set a target**
📍 Menu: Business Intelligence ➜ **KPI Targets** ➜ **Add** ➜ choose **Sales Invoiced MTD**, a plant and a target amount for the month ➜ Save.
✅ The most specific target wins: one for a person beats one for a department, which beats one for a plant, which beats one for everyone.

**B. See your numbers with a colour**
📍 Menu: Executive ➜ **My Dashboard**
✅ Each tile shows the value, the target and the percentage reached, with a colour: **green at 90 % or more, amber from 75 % up to 90 %, red below 75 %** (exactly 90 is green and exactly 75 is amber). Press the **i** on a tile to see how it is worked out and where the numbers come from. If there is nothing to measure yet, the tile says "No data in period" instead of a made-up number. Your own approvals and your own documents by status are shown too. (Department KPIs on this page are the plant's figures, and a note says so.)

**Owner / Plant head**
**C. All plants side by side**
📍 Choose two or more plants in the top bar ➜ Menu: Executive ➜ **Plant Dashboard**
✅ A grid with one row per KPI and one column per plant, plus a **Total** column. Totals are added only for amounts and counts. Percentages, days and ratios are never added up.

**D. The Owner Console**
📍 Menu: Executive ➜ **Owner Console**
✅ The plant grid, the approvals waiting by age, and statutory filings waiting for review.

**E. Analytics pages for each area**
📍 Menu: Business Intelligence ➜ **Production Analytics**, **Quality Analytics**, **HR Analytics**, **Maintenance Analytics**, **Project Analytics**, **Service Analytics** and **Logistics Analytics**
✅ Each page shows that area's KPIs for the plants you chose.

**F. A TV screen for the shop floor or the office wall**
📍 **Plant Dashboard** ➜ **Create TV link** ➜ copy the link and open it on a TV or a phone (a private window is fine).
✅ Large figures that refresh by themselves every minute and move from plant to plant. It is read-only. If you create a new link, the old link stops working.

**G. Alerts**
📍 Menu: Business Intelligence ➜ **KPI Alerts** ➜ **Add** ➜ for example "Pending Approvals above 0".
✅ When the number crosses the line, you get a notification (the bell). You get it once, not again and again, until the waiting time you set has passed.

**H. Dashboards by email**
✅ The Administrator can set a daily dashboard email. Each person receives the figures for **their own plants only**. (A page to set these up is planned for a later phase.)

---

### PART 12E: Moving work between departments (Phase 25)

**Sales**
**A. Send a document to the next department**
📍 Open a Sales Order ➜ press **Move Forward** ➜ choose **Production** (the system suggests the usual next department) ➜ choose the manager who should handle it ➜ Send.
✅ The order is marked **Sent**. Only one department can hold a document at a time. If someone else already moved it, you get a clear message instead of a double move.

**Production manager**
**B. Receive and accept**
📍 Menu: Executive ➜ **Department Inbox** ➜ **To Receive**
✅ The order is listed. Press **Received** and it moves to **To Accept**. Press **Accepted** and it moves to **In Work**. If someone in your department has already received it, the system tells you who and when.

**C. Send it back**
📍 In **To Receive** or **To Accept** press **Return** and type a reason of at least 10 characters.
✅ The document goes back to the sender as a new item in their inbox, with your reason.

**Sales**
**D. The edit lock**
📍 Try **Edit** on the order that Production is holding.
✅ The system says "Currently with Production since … Only they can edit it." The Owner and Administrator can still edit.

**E. History**
📍 Open the order ➜ **History**
✅ Every step (sent, received, accepted, returned) is listed with the person and the time. The history cannot be changed afterwards.

**F. Late work**
✅ Each move has a time allowance counted in working days (Monday to Saturday, skipping Sundays and your plant holidays). Work that is late is flagged and the receiving manager is told. If it stays late for twice the allowance, the department head is told as well.

**Administrator**
**G. The Workflow Matrix**
📍 Menu: Administration ➜ **Workflow Builder** (it shows the Workflow Matrix) ➜ change the next department for Sales Orders ➜ Save.
✅ The next **Move Forward** on a Sales Order suggests the new department.

**H. All movements, and the Work Center**
📍 Menu: Executive ➜ **All Department Movements** (Director, Administrator and Owner) and **Department Work Center** (accepted work of your department, by document type).

⚠️ **Please note:** moving a document between plants records the quantities and short receipts, but it does **not** move stock yet. Move Forward also does not yet check approvals. The plant route, transfer note and bill-of-material approval screens come in a later phase.

---

### PART 12F: Product development gates, 360° tracking and Process Exceptions (Phase 26)

**Sales**
**A. Sales Enquiries**
📍 Menu: Sales ➜ **Sales Enquiries** ➜ **＋ Add** (a TEST prospect name, the product, a quantity; choose a template **BLDC motor** for a new motor project)
✅ The enquiry gets a number like `ENQ/TAL/…/0001`. Try **Lost** without a reason: it asks for one. An enquiry for a prospect cannot become a quotation until the customer exists (create the customer, then pick it).
📍 On an enquiry with a customer: **Create Quotation** makes a draft quotation. **Create Project** makes a project with its gates.

**Projects**
**B. Product development gates (BLDC and SPPM)**
📍 Menu: Projects ➜ **Project Stage Gates** ➜ choose the project
✅ Gate cards show a lock when locked, a colour for the state, the department that owns the gate, a due date and a **readiness bar**. Only the first gate is open at the start.
- **Documents tab:** add the gate's deliverable (for example a URS) and **Approve** it.
- **Specifications tab:** add a parameter with a target and a tolerance (for example speed 1500 ± 30 rpm).
- **Test records tab:** add a test with a value: it shows **OK** or **NG** by itself.
- On the gate press **Submit**. If something is missing, the message says exactly what, for example "Gate G03 needs: approved SPEC, 2 tests passed."
- When the approval is done, the **next gate opens** and its department is told. Nothing moves by itself.
📍 **Download dossier PDF** gives the cover, gates, specifications, test results, documents and history in one file.

**C. Project History**
📍 Menu: Executive ➜ **Project History** ➜ choose a project
✅ Every event in time order with the department and the person. **Export Excel** downloads it. Events of a plant you did not choose show "Event in another plant."

**Director / Sales**
**D. 360° Order Tracking**
📍 Menu: Executive ➜ **360 Order Tracking** ➜ choose a sales order
✅ The journey from enquiry to collection, the document numbers, who holds the order now, the lines with progress bars and one **progress %** (order 5 · material 25 · production 35 · quality 10 · dispatch 15 · billing 5 · collection 5).

**E. Process Exceptions**
📍 Menu: Executive ➜ **Process Exceptions** (press **Check now**)
✅ Late items are grouped by the department that owns them: a gate past its due date, a purchase order past its delivery date, goods waiting for quality check, a delivery challan with no invoice, an invoice overdue by 30 days, late department work. Fix the cause and the item clears by itself. You can add a **Note** or **Resolve** by hand.

---

### PART 12G: Documents, Mail and ready-made email automations (Phase 27)

**Anyone**
**A. Print a record in 5 formats**
📍 Open any record ➜ **Print ▾**
✅ Standard PDF, Letterhead PDF, Commercial PDF, **Word** and **Excel**. A draft is marked DRAFT; a posted document is marked **Original** the first time and **Duplicate** after that. The Word file opens in Microsoft Word, is editable and says "Uncontrolled copy" at the bottom.

**B. Document Center**
📍 Menu: Document Management ➜ **Document Center**
✅ Choose a document type on the left (quotation, sales order, delivery challan, GST invoice, purchase order, goods receipt, quality certificate and more, each with its count), then a record. On the right: **Print ▾** and **Send to Department** (this is the same as Move Forward).

**C. Department Mail**
📍 Menu: Communication ➜ **Department Mail** ➜ **Compose**
✅ Choose a department (or type an outside email address), keep or change the subject and message, **Send**. Only people who work in your plant get the message. The inbox shows unread mail in bold; the **Sent** tab shows how many people have read it.

**Quality**
**D. Quality Certificates**
📍 Menu: Quality ➜ **Quality Certificates** ➜ **＋ Add**
✅ Accepted plus rejected cannot be more than the sample quantity, and a failed certificate needs the NCR number. A different person presses **Release**; the person who made it cannot. Then **Print ▾** for a PDF or Word certificate.

**HR**
**E. Offer and Appointment letters**
📍 Menu: HRMS ➜ **Offer & Appointment Letters** ➜ **＋ Add**
✅ Pick the template and fill the details (a missing detail is refused). A different person presses **Approve**; only then can you **Issue** it ("The offer letter must be approved before issue."). **Email** sends it to the candidate. Print it as PDF or Word.

**Administrator**
**F. Mail Automation**
📍 Menu: Administration ➜ **Mail Automation**
✅ 40 ready automations in cards by area (quotation, order acknowledgement, dispatch, supplier reminders, approval reminders, owner's morning summary and more). On each card:
- the **On** switch (and a switch per plant if you have more than one);
- **Edit template** (subject, message, time, days);
- **Send test to me** (an email with sample data comes to you);
- **Last runs** (what was sent, skipped or failed).
The ones marked **Live** run by themselves: order acknowledgement, delivery reminder and delivery overdue (to the supplier, with the buyer in copy), approval waiting and escalation, approval result, work sent / late / returned, and the Owner daily summary at 08:00. The ones marked **Planned** can be edited and tested but start by themselves in a later phase. The same email is never sent twice for the same record on the same day.

---

### PART 12H: Attendance that runs by itself (Phase 28)

**HR**
**A. Devices & Sync**
📍 Menu: HRMS ➜ **Devices & Sync**
✅ Each machine is a card with a status colour: **green** (data is arriving), **amber** (nothing for 30 minutes) or **red** (nothing for 2 hours), the last punch time, today's punch count and any unknown codes. Register a machine with its **serial number**: the machine then sends its punches to the ERP by itself. A machine that is not registered is refused and HR gets an alert. The sync log shows what arrived, how many were new and how many were repeats.

**B. Policies**
📍 Menu: HRMS ➜ **Attendance Policies**
✅ One card per rule with a switch, its settings and a plain-English line, for example "If a person is late 3 times in a month, 0.5 day is deducted." You can set a rule for all plants or for one plant. Try **Late-mark rule ON**: the 3rd late day shows "−0.5 day" with the reason "3rd late mark in November (4, 11, 18)". The **Automation log** at the bottom lists every automatic change with its reason. **Reverse** needs a reason; nothing silently changes pay.

**Employee and Manager**
**C. Missed punch**
📍 Skip your out-punch on a working day.
✅ Next morning at about 10:00 you and your manager get a reminder: "Missed out-punch on … Regularise in ESS." If it is not regularised in 3 days it becomes a **half day** with the reason shown, and HR can reverse it.

**D. Overtime**
📍 Work beyond the shift on a day.
✅ An **overtime request** goes to your manager automatically.

**E. Daily report**
✅ From 10:30 each department manager gets an email: yesterday's present, late, absent, missed-punch and on-leave counts for that department, for their own plant only.

**Everyone**
**F. Live Attendance Board**
📍 Menu: HRMS ➜ **Live Attendance Board**
✅ Tiles per department show **inside now / expected** with a percentage and refresh every 30 seconds. Punch on the machine: within a minute the count changes.

**HR head**
**G. Month lock**
✅ On the **2nd of the next month at 18:00** the month locks by itself: every day is calculated, the late-mark deductions are included, and the figures are ready for payroll. A locked day does not change. To correct something, HR head unlocks the month and **must give a reason**.

**H. Punch from the phone (when switched on)**
📍 Menu: HRMS ➜ **Punch Sites** to set the site circles; switch on **Mobile punch** in Attendance Policies.
✅ A phone punch is accepted only inside a site circle: outside, it says "You are 640 m from Talwade gate. Punch from inside the site."

⚠️ **Please note:** the small program for plant PCs (for machines that cannot send by themselves), the Punch button inside the Employee Self-Service page, automatic leave cover, and the Excel attachment on the daily report come later. Days that were stored before this update keep their old late and overtime numbers until they are recalculated.

---

### PART 12I: Workplace operations: tasks, handover, visitors, canteen (Phase 29)

**Manager**
**A. Tasks**
📍 Menu: Executive ➜ **Task Management** ➜ **＋ Add**
✅ Each task gets a number like `T/TAL/…/00001`. Tabs: Task Register, Department Board, My Tasks, Due & Overdue, **Workload** (a person with more than 10 open or 3 overdue tasks is red) and Task Approval. A task that must wait for another task cannot be started: it says "Blocked by T/TAL/… (not done)." Tasks that need approval wait for a **different** person to approve after they are done. A recurring task (for example a daily 5S check, Monday to Saturday) creates its own task each morning.

**Shift in-charge**
**B. Shift handover**
📍 Menu: HRMS ➜ **Shift Roster & Handover** ➜ **＋ New handover**
✅ Fill what was planned and done, the issues, safety and materials short, then **Submit**. The incoming in-charge presses **Accept** (or **Reject** with a reason). If it is not accepted within 30 minutes of the shift start, the department manager gets an alert.

**Security and host**
**C. Visitors**
📍 Menu: Logistics ➜ **Visitor Management** ➜ **＋ Pre-register**
✅ The host approves ("… has not approved this visit yet." until then). At the gate press **Check in** (or use the QR code); the host is told. **Inside Plant** shows each visitor with minutes inside; a visitor still inside 30 minutes after the planned time is marked **Overstay** and the host and security are alerted. **Check out** when they leave. Only the last 4 characters of the ID are kept, and after one year the visitor's personal details are removed.

**Canteen counter and HR**
**D. Canteen**
📍 Menu: HRMS ➜ **Canteen**
✅ **Counter:** type or scan the employee code and press Serve: a green line shows the meal served; scanning the same person twice shows "Already served lunch today at 13:02." in red. **Rate Master:** set a rate with GST and the employee's share (for example lunch ₹60 + 5 % GST = ₹63.00; the employee pays 40 % = ₹25.20; the company ₹37.80). **Department Cost & Month:** costs by department; **Close month** sends the employee share to payroll as a deduction (**CANTEEN_DED** on the payslip) and posts the company share to Staff Welfare. After closing, the counter says "… canteen is closed."

⚠️ **Please note:** the Visitor button on the Gate Kiosk, drag-and-drop on the task board, the pass with a printed QR image, contract-worker meals and the entitlement-per-shift screen come later.

---

### PART 12J: Contract labour (Phase 30)

**HR**
**A. Contractor and work order**
📍 Menu: HRMS ➜ **Contractors** ➜ **＋ Add** (a TEST contractor with licence, agreement and insurance dates), then a different person presses **Approve**.
📍 Menu: HRMS ➜ **Contract Work Orders** ➜ **＋ Add** (skill, headcount, daily rate, budget), then a different person presses **Activate**.
✅ The daily rate cannot be below the minimum wage ("Wage rate ₹300 is below the minimum wage ₹560 for Skilled."). The budget shows green, turns **amber at 90 %** and **blocks new deployments at 100 %**.

**B. Workers and deployment**
📍 Menu: HRMS ➜ **Contract Workers** ➜ **＋ Add** (only the last 4 digits of Aadhaar are asked), then **Checks / Deploy**.
✅ Record KYC, medical, induction, police verification (if needed) and PPE with their valid-until dates, choose the work order and press **Deploy**. If anything is missing or expired the system says exactly what: for example "Can't deploy: medical fitness expired on 02-11-2026." or "Work order headcount full (5/5)."

**C. Daily attendance**
📍 Menu: HRMS ➜ **Contract Attendance** ➜ pick a date ➜ **Build muster**
✅ The day is built from the machine punches (in, out, regular hours, overtime). A day where the person was not at the gate must be approved by a supervisor before it is paid.

**D. Wages**
📍 Menu: HRMS ➜ **Contract Wages** ➜ choose the contractor and month ➜ **Compute**
✅ For 26 days at ₹600 and 10 hours of overtime: gross ₹17,100, PF ₹1,800, ESIC ₹129, professional tax ₹200, **net ₹14,971** (February professional tax is ₹300). **Lines** shows each worker; **Bank advice** downloads the payout file; **Lock** freezes the sheet.

**Finance**
**E. Contractor bills and the payment block**
📍 Menu: HRMS ➜ **Contractor Bills** ➜ **＋ Add bill** ➜ **Reconcile**
✅ The bill is checked against the muster: for example 28 man-days billed but 26 mustered shows **2 days disputed (₹1,416 with GST)**. GST 18 % and TDS are worked out.
📍 Menu: HRMS ➜ **Contract Compliance** ➜ choose the contractor and month ➜ **Upload** each proof (PF ECR, PF challan, ESIC challan, muster roll, wage register, bank proof, bonus register, return). A different person presses **Verify**.
✅ The score is passed checks out of 11 (10 of 11 = 90.91 %). Press **Approve payment** on the bill before 100 %: "Payment blocked: ESIC challan for 2026-11 not uploaded." At 100 % only the **undisputed part** can be approved.

**Owner and EHS**
**F. Command Center and incidents**
📍 Menu: Executive ➜ **Contract Labour Command Center**
✅ Workers on site, active contractors, licences expiring in 30 days, wage sheets pending, bills blocked and incidents this month, with the headcount by plant and contractor. Safety incidents are recorded under HRMS ➜ **Contract Safety Incidents**.

⚠️ **Please note:** the wage slip PDF, contractor prequalification screens, the contract-worker gate pass and canteen pages, and posting the approved bill to Accounts Payable come later. The minimum-wage rows must be confirmed against the current Maharashtra notification before the first real wage sheet.

---

### PART 12K: Admin control centre (Phase 31)

**Administrator**
**A. Your own fields on any form**
📍 Menu: Administration ➜ **Custom Fields** ➜ type the page (for example `sales-orders`) ➜ **Add a field** (for example key `drawing_no`, label "Drawing No", type text)
✅ The field is checked when a value is saved (a number must be a number, a choice must be one of the choices). You can limit it to some plants or roles. It appears on the printed document and in the Excel: print the order as **Word**, **PDF** or **Excel** and the line "Drawing No: DRG-4412-B" is there. Tick or untick **PDF** and **Excel** per field. A page can have up to 50 custom fields; they are never used in money or tax calculations.

**B. Form rules**
📍 Menu: Administration ➜ **Form Builder** ➜ **Add a rule** (page, field, **Required / Read-only / Hidden**, optionally a role and a status)
✅ For example: Payment Terms is read-only for Employees once the order is Approved, and required while it is Draft. The rule is enforced by the server, so it also holds if someone bypasses the screen. Fields the system needs (status, number, customer, item ...) cannot be hidden or made optional.

**C. Modules per plant**
📍 Menu: Administration ➜ **Modules per Plant** ➜ choose a page and a plant ➜ **Switch off**
✅ People of that plant no longer see the module in the Menu, and if they try to open it the system says "Canteen is turned off for Varale." Other plants are not affected and the data stays.

**D. Sign-in rules, sessions and keys**
📍 Menu: Administration ➜ **Login Policies** ➜ choose a role, set the hours (for example 06:00 to 23:00) and the allowed IP ranges.
✅ A sign-in outside the rules is refused with the reason and recorded.
📍 Menu: Administration ➜ **Sessions** ✅ Everyone signed in now; **Force logout** ends a session immediately.
📍 Menu: Administration ➜ **API Keys** ✅ The key is shown only once when you create it.
📍 Menu: Administration ➜ **Numbering** ✅ Type a prefix, number of digits, plant and year to **preview** a number; a GST document number cannot be longer than 16 characters.
📍 Menu: Administration ➜ **System Health** ✅ Database speed, job queues and the email queue, with the owner's control cards.

**Owner**
**E. View as**
📍 Menu: Administration ➜ **View As** ➜ choose an employee, type the reason ➜ **Start**
✅ A **red banner** says "Viewing as … — read-only." You see exactly what that person sees, and nothing can be changed. It ends after 30 minutes or when you press **Stop**; every use is recorded.

⚠️ **Please note:** custom fields do not yet appear inside the existing add / edit forms and registers (they print and have their own screen and endpoint); the Data Center (bulk import, duplicate merge, module backup), the integrations page, MFA-per-role and automatic disabling of inactive users, and API-key sign-in come later.

---

### PART 12L: External connections (Phase 34)

**Administrator**
**A. Integrations & API Vault**
📍 Menu: Administration ➜ **Integrations** (page `admin-integrations`)
✅ Cards for **GST e-Invoice (IRP)**, **E-Way Bill**, **WhatsApp Cloud**, **Bank feed** and **Email relay**. Every card starts as **DISABLED**: nothing is sent to any outside service. Press **Configure** to choose **Sandbox** (safe test) or **Live**, type the service address and the keys. After saving, the keys show only their last 4 characters (••••1234) and are stored encrypted. **Test connection** shows "Connected" or the reason, and **Recent calls** lists every call without any secret.

**Finance**
**B. e-Invoice (IRN) in Sandbox**
📍 Set GST e-Invoice to **Sandbox**, then generate the IRN for a posted invoice of a registered customer (the invoice screen button comes later; ask your support contact to run the generate action for a first check).
✅ The invoice gets its IRN, acknowledgement number and signed QR. A second try says it already has one; a draft invoice or an unregistered customer is refused with the reason. While the card is Disabled the message is "Live GST_IRP adapter is disabled; download JSON or enable Sandbox/Live in Integrations." and the JSON download keeps working.

**Administrator**
**C. Outbound webhooks**
📍 Menu: Administration ➜ **Outbound Webhooks** ➜ **Add an endpoint** (a public https address and the events)
✅ The signing secret is shown only once. Each message is signed. If the receiving address fails, the system tries again after 1, 2, 4 and 8 minutes; after the 5th failure it lands in the **Dead-letter queue** and the Administrator gets a notice. Press **Replay** to send it again. An address that points inside your own network is refused.

⚠️ **Please note:** no live connection to the GST portal, a bank or WhatsApp has been made yet; those need your account details and a first test in Sandbox. The Generate IRN button on the invoice screen, E-Way Bill generation and bank-statement matching come later.

---

### PART 13: Your reports & home dashboard

**66. Money, tax & profitability**
📍 Menu: Finance ➜ **Profit & Loss** (🔗 https://erp.sawantgroup.co.in/m/fin-pnl)
📍 Menu: Taxation ➜ **GSTR-1** (🔗 https://erp.sawantgroup.co.in/m/tax-gstr1)
✅ Check your financials: all project billings, AMC revenues, salaries, maintenance costs, freight RCM, and warranty recoveries flow cleanly into your P&L and monthly GST returns without manual journal entries.

**67. The home page & approvals**
📍 Click **Home** (the logo at the top left)
🔗 https://erp.sawantgroup.co.in/
✅ The Home page gives you a birds-eye view of your work: To Receive, To Accept, In Work, Returned, My Approvals and Overdue, plus quick-create buttons, your favourites and live alerts. (See Part 12C.)

---

**Handy extras while you test:**
- Many lists have an **Export Excel** button.
- Orders, job cards, bills of material, salary payslips, asset QR labels, gate challans, and service visit reports have a **Print / PDF** button — and posted invoices now have an **Email** button right alongside them!
- 📱 **On your phone:** please install the PWA from 🔗 https://erp.sawantgroup.co.in/install or open the site directly. The navigation collapses into a neat drawer, and **Shop Floor**, **Gate Kiosk**, **Employee Self-Service**, and **Mobile Visits** screens are tailored for touchscreens and tablets.

---

**Pre-launch external setup notes (handled during Go-Live cut-over):**
- Live **AWS SES** production access + DNS records (`Easy DKIM`, custom `MAIL FROM`, `DMARC`) and production **VAPID** push keys are provisioned on cut-over (visible live in **Notification & Email Health**).
- External live GST e-invoice portal NIC/GSP credentials, live WhatsApp/TRAI DLT SMS carrier keys, and direct PLC/IoT machine sensor telemetry connectors connect during production cut-over.

**How to give feedback 🙏**
As you click around, if anything looks odd, is confusing, or you'd like a button moved or renamed, just take a screenshot and send it to me here with a quick note about what you expected. There are no silly comments, so please tell me everything!

Take your time. It is a comprehensive system, so feel free to test a couple of parts at a time. Let me know how it goes!

Thank you! 😊

Best regards,  
[Your Name]

---

### Release status (final)
All 35 phases are built. Everything shown in this guide has been checked automatically on the server side. Screens were checked by building them cleanly; the full click-through of every screen with all nine roles, the load test and the restore drill still have to be run and signed off before the final go-live.
