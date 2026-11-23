-- Documents can be attached to a record of ANY page, not only generic_records (Sales Enquiries, Quotations, Orders ...
-- keep their records in their own tables). The foreign key made every upload for those pages fail with a 500.
-- record_documents.page_id + record_id still identify the record; the API checks the record in its own table.
ALTER TABLE "record_documents" DROP CONSTRAINT IF EXISTS "record_documents_record_id_fkey";
