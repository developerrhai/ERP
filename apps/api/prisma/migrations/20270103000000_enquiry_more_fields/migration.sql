-- Sales Enquiries add form (QA report Sales10): price discussion, next follow-up date and remarks.
ALTER TABLE "sales_enquiries" ADD COLUMN IF NOT EXISTS "price_discussion" text;
ALTER TABLE "sales_enquiries" ADD COLUMN IF NOT EXISTS "next_follow_up" date;
ALTER TABLE "sales_enquiries" ADD COLUMN IF NOT EXISTS "remarks" text;
