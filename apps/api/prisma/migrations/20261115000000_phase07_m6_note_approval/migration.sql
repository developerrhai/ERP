-- Phase 07 M6: notes may wait for approval (above the limit the administrator sets in Finance Approval Limits).
ALTER TABLE "credit_debit_notes" DROP CONSTRAINT "credit_debit_notes_status_check";
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_status_check"
  CHECK ("status" IN ('Draft','Pending Approval','Approved','Rejected','Posted','Cancelled'));
