Hello Sir/Madam,

Here is the current state of the Sawant Group ERP, ready for your testing. It is updated after every phase.

⚠️ This is the TEST version. Please do not enter real business data. Test records may be cleared.

🔐 Test logins (you set a new password on first sign-in)
1. Employee (Purchase)       ID: <id>   Password: <password>
2. Department Manager        ID: <id>   Password: <password>
3. Department Head           ID: <id>   Password: <password>
4. General Manager           ID: <id>   Password: <password>
5. Director                  ID: <id>   Password: <password>
6. Administrator             ID: <id>   Password: <password>

━━━━━━━━━━━━━━
✅ EVERYTHING THAT WORKS SO FAR
━━━━━━━━━━━━━━
* Sign-in by role (with a second step for administrators). Each person sees only the pages and plants given to them.
* Plants: Talwade, Sawardari, Varale. You can see one, two or all plants from the top bar; new records belong to one plant.
* Masters: customers, suppliers, items, HSN / SAC with GST rate, units, departments, designations, price lists.
* Sales and purchase documents: enquiry, quotation, sales order, delivery challan, invoice, return; purchase request, RFQ, quotation, comparison, purchase order, goods receipt, purchase invoice. GST (CGST + SGST or IGST) is worked out from the plant and the customer or supplier state.
* Approvals by department and amount, with delegation, rejection with a reason, and notifications.
* Department Inbox: a record moves from one department to the next (Move Forward, Received, Accepted, Return) and every step is stamped with a name and time.
* Inventory and warehouses: stock, ledger, adjustments, transfers, counts, bins, picking.
* Manufacturing, quality and maintenance screens; finance (journals, ledgers, GST, TDS) ; HR, attendance, leave, payroll, ESS; projects and tasks; service and logistics; contract labour; workplace (tasks, visitors, canteen).
* Dashboards: My Dashboard, plant comparison, Owner console, module analytics, TV link.
* Print: PDF, Word and Excel from records.
* Dates are always dd-mm-yyyy; money is in ₹ with Indian commas.

━━━━━━━━━━━━━━
🔧 NEW IN PHASE 37 (fixes)
━━━━━━━━━━━━━━
* HSN / SAC form now asks for the GST rate, cess and the date it starts. Document lines take the rate from the item's HSN. If there is none you see: "No GST rate for HSN … — set it in HSN / SAC."
* A new plant must have its state code. A plant without one shows: "Plant … has no state set. Ask Admin to complete it."
* Document lines show item code, name, unit and HSN, never a long id.
* Every date box shows and accepts dd-mm-yyyy.
* Attendance for a month opens without an error. A login not linked to an employee sees "Your login is not linked to an employee record. Ask HR."
* Projects: creating a project, budget, tasks and expenses now saves correctly.
* Submit Approval is greyed on a record that is already waiting for approval.
* After saving in a form, the form closes and the saved record opens.

━━━━━━━━━━━━━━
⏳ NOT FINISHED YET (coming in the next phases)
━━━━━━━━━━━━━━
* The page tabs of the approved design (most pages still show only the first view).
* The full approved layout of the main document forms.
* Automatic emails (the 40 ready automations), e-invoice, e-way bill, payment links, bank feeds, GST portal connections: these need your accounts and keys; the list is in docs/build/OWNER-ACTIONS.md.

📩 Please send a screenshot or a short note for anything wrong, confusing or missing.

Thank you! 🙏
