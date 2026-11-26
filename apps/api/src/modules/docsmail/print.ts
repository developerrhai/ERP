// Phase 27: one print service for every record. render(pageId, id, kind) builds ONE view-model (PrintDto) and the adapters
// produce PDF (pdfkit), Word (docx) or Excel (exceljs). Posted documents carry an "Original" / "Duplicate" copy label,
// drafts a DRAFT mark, and Word files an "Uncontrolled copy" footer.
import { controlService } from '../control/service';
import ExcelJS from 'exceljs';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { accessUserOf, can } from '../../core/rbac/access';
import { formatInr, rupeesInWords } from '../../core/pdf/amount-words';
import { renderDocumentPdf } from '../../core/pdf/template';
import type { PdfLetterhead } from '../../core/pdf/template';
import { typedSchema } from '../inventory/definitions';
import { getPrintDataBuilder } from '../../kit/print';
import type { PrintDto } from '../../kit/print';
import { letterheadFor, recordPdfService } from '../records/pdf';
import type { Caller } from '../records/service';
import { stripHtml } from './letters';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';

export type PrintKind = 'standard' | 'letterhead' | 'commercial' | 'word' | 'excel';
export const PRINT_KINDS: readonly PrintKind[] = ['standard', 'letterhead', 'commercial', 'word', 'excel'];

export interface CatalogDoc {
  pageId: string;
  title: string;
  group: string;
  table: string;
  numberCol: string;
  dateCol: string;
  statusCol: string;
  unitCol: string | null;
  lines?: { table: string; fk: string };
  totalCol?: string;
  partyCol?: string;
}

/** The ~25 business documents of the Document Center. Every one prints in 5 formats. */
export const CATALOG: readonly CatalogDoc[] = [
  { pageId: 'sales-quotations', title: 'Quotation', group: 'Sales', table: 'sales_quotations', numberCol: 'number', dateCol: 'quote_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_quotation_lines', fk: 'quotation_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-orders', title: 'Sales Order', group: 'Sales', table: 'sales_orders', numberCol: 'number', dateCol: 'order_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_order_lines', fk: 'order_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-dispatch', title: 'Delivery Challan', group: 'Sales', table: 'sales_dispatches', numberCol: 'number', dateCol: 'dispatch_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_dispatch_lines', fk: 'dispatch_id' } },
  { pageId: 'sales-invoices', title: 'GST Tax Invoice', group: 'Sales', table: 'sales_invoices', numberCol: 'number', dateCol: 'invoice_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_invoice_lines', fk: 'invoice_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-collections', title: 'Payment Receipt', group: 'Sales', table: 'sales_receipts', numberCol: 'number', dateCol: 'receipt_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'sales-returns', title: 'Sales Return', group: 'Sales', table: 'sales_returns', numberCol: 'number', dateCol: 'return_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'sales_return_lines', fk: 'return_id' }, totalCol: 'grand_total' },
  { pageId: 'sales-enquiries', title: 'Sales Enquiry', group: 'Sales', table: 'sales_enquiries', numberCol: 'number', dateCol: 'enq_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'scm-pr', title: 'Purchase Requisition', group: 'Procurement', table: 'purchase_requisitions', numberCol: 'number', dateCol: 'required_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'purchase_requisition_lines', fk: 'pr_id' } },
  { pageId: 'scm-rfq', title: 'Request for Quotation', group: 'Procurement', table: 'rfqs', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'rfq_lines', fk: 'rfq_id' } },
  { pageId: 'scm-po', title: 'Purchase Order', group: 'Procurement', table: 'purchase_orders', numberCol: 'number', dateCol: 'po_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'purchase_order_lines', fk: 'po_id' }, totalCol: 'grand_total' },
  { pageId: 'scm-grn', title: 'Goods Receipt Note', group: 'Procurement', table: 'goods_receipts', numberCol: 'number', dateCol: 'receipt_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'goods_receipt_lines', fk: 'grn_id' }, totalCol: 'total_value' },
  { pageId: 'scm-purchaseinvoice', title: 'Purchase Invoice', group: 'Procurement', table: 'purchase_invoices', numberCol: 'number', dateCol: 'invoice_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'purchase_invoice_lines', fk: 'invoice_id' }, totalCol: 'grand_total' },
  { pageId: 'mfg-orders', title: 'Production Order', group: 'Manufacturing', table: 'mfg_orders', numberCol: 'number', dateCol: 'start_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-inspections', title: 'Inspection Report', group: 'Quality', table: 'qms_inspections', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'quality-certificate', title: 'Quality Certificate', group: 'Quality', table: 'quality_certificates', numberCol: 'number', dateCol: 'inspection_date', statusCol: 'quality_approval', unitCol: 'unit_id' },
  { pageId: 'inv-adjustment', title: 'Stock Voucher', group: 'Inventory', table: 'stock_vouchers', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'stock_voucher_lines', fk: 'voucher_id' } },
  { pageId: 'gate-out', title: 'Gate Pass', group: 'Logistics', table: 'gate_passes', numberCol: 'pass_no', dateCol: 'entry_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'log-shipments', title: 'Shipment', group: 'Logistics', table: 'shipments', numberCol: 'shipment_no', dateCol: 'planned_dispatch_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'service-tickets', title: 'Service Ticket', group: 'Service', table: 'service_tickets', numberCol: 'ticket_no', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'proj-projects', title: 'Project', group: 'Projects', table: 'projects', numberCol: 'code', dateCol: 'start_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'ops-visitors', title: 'Visitor Pass', group: 'Logistics', table: 'visitor_passes', numberCol: 'pass_no', dateCol: 'visit_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'hr-offer-letter', title: 'Letters (offer / appointment)', group: 'HR', table: 'issued_letters', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
];

/**
 * Pages that keep their records in their own table (not the generic record engine) and are not Document Center documents:
 * Word / PDF / Excel and the Docs upload of their rows read the table row directly (no 'own storage' refusal).
 */
export const TYPED_DOCS: readonly CatalogDoc[] = [
  { pageId: 'inv-items', title: 'Item Master', group: 'Inventory', table: 'items', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  // Product / Raw Material Master are views of the item table, so their toolbar Word / PDF print the item
  { pageId: 'master-products', title: 'Product', group: 'Inventory', table: 'items', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'master-materials', title: 'Raw Material', group: 'Inventory', table: 'items', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  // one row per item and warehouse (view stock_balance_records)
  { pageId: 'inv-stock', title: 'Stock Balance', group: 'Inventory', table: 'stock_balance_records', numberCol: 'number', dateCol: 'updated_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'wms-warehouses', title: 'Warehouse', group: 'Inventory', table: 'warehouses', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'inv-batch', title: 'Batch', group: 'Inventory', table: 'batches', numberCol: 'batch_no', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'inv-serial', title: 'Serial Number', group: 'Inventory', table: 'serial_numbers', numberCol: 'serial_no', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'inv-reservation', title: 'Stock Reservation', group: 'Inventory', table: 'stock_reservations', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'crm-leads', title: 'Lead', group: 'CRM', table: 'leads', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'crm-opportunities', title: 'Opportunity', group: 'CRM', table: 'opportunities', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'crm-followups', title: 'Follow-up', group: 'CRM', table: 'crm_followups', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'crm-meetings', title: 'Meeting', group: 'CRM', table: 'crm_meetings', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'crm-feedback', title: 'Customer Feedback', group: 'CRM', table: 'crm_feedback', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'crm-sources', title: 'Lead Source', group: 'CRM', table: 'lead_sources', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'sales-reservations', title: 'Stock Reservation', group: 'Sales', table: 'stock_reservations', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'sales-pricelist', title: 'Price List', group: 'Sales', table: 'price_lists', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'master-customers', title: 'Customer', group: 'Sales', table: 'customers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'crm-customer360', title: 'Customer 360', group: 'Sales', table: 'customers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'fin-journal', title: 'Journal Voucher', group: 'Finance', table: 'journals', numberCol: 'code', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-gl', title: 'Ledger Entry', group: 'Finance', table: 'gl_entries', numberCol: 'voucher_no', dateCol: 'posting_date', statusCol: 'voucher_type', unitCol: 'unit_id' },
  { pageId: 'fin-cashbook', title: 'Cash Book Entry', group: 'Finance', table: 'gl_entries', numberCol: 'voucher_no', dateCol: 'posting_date', statusCol: 'voucher_type', unitCol: 'unit_id' },
  { pageId: 'fin-bankbook', title: 'Bank Book Entry', group: 'Finance', table: 'gl_entries', numberCol: 'voucher_no', dateCol: 'posting_date', statusCol: 'voucher_type', unitCol: 'unit_id' },
  { pageId: 'fin-ap', title: 'Payable', group: 'Finance', table: 'open_items', numberCol: 'doc_no', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-ar', title: 'Receivable', group: 'Finance', table: 'open_items', numberCol: 'doc_no', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-creditnote', title: 'Credit Note', group: 'Finance', table: 'credit_debit_notes', numberCol: 'code', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-debitnote', title: 'Debit Note', group: 'Finance', table: 'credit_debit_notes', numberCol: 'code', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-bankreco', title: 'Bank Statement', group: 'Finance', table: 'bank_statements', numberCol: 'period_to', dateCol: 'period_to', statusCol: 'status', unitCol: null },
  { pageId: 'fin-costcenter', title: 'Cost Center', group: 'Finance', table: 'cost_centers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-profitcenter', title: 'Profit Center', group: 'Finance', table: 'profit_centers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-expenses', title: 'Expense Claim', group: 'Finance', table: 'expense_claims', numberCol: 'code', dateCol: 'claim_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'fin-budget', title: 'Budget', group: 'Finance', table: 'budgets', numberCol: 'name', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'scm-suppliers', title: 'Supplier', group: 'Procurement', table: 'suppliers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'fin-coa', title: 'Account', group: 'Finance', table: 'accounts', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  // Quality, Maintenance, Production and the register views of Sales / Finance: their rows print, e-mail and take
  // documents straight from the table row ('' = the table has no status column)
  { pageId: 'qms-incoming', title: 'Incoming Inspection', group: 'Quality', table: 'qms_inspections', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-process', title: 'In-Process Inspection', group: 'Quality', table: 'qms_inspections', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-final', title: 'Final Inspection', group: 'Quality', table: 'qms_inspections', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-plans', title: 'Inspection Plan', group: 'Quality', table: 'qms_plans', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'qms-ncr', title: 'Non-Conformance Report', group: 'Quality', table: 'qms_rejections', numberCol: 'number', dateCol: 'reject_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-capa', title: 'CAPA Report', group: 'Quality', table: 'qms_forms', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-mom', title: 'Minutes of Meeting', group: 'Quality', table: 'qms_forms', numberCol: 'number', dateCol: 'doc_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-5why', title: '5 Why Analysis', group: 'Quality', table: 'five_why_cases', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'qms-calibration', title: 'Calibration Record', group: 'Quality', table: 'qms_instruments', numberCol: 'equipment_no', dateCol: 'valid_until', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-machines', title: 'Machine', group: 'Maintenance', table: 'assets', numberCol: 'asset_no', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-equipment', title: 'Equipment', group: 'Maintenance', table: 'assets', numberCol: 'asset_no', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-mtbf', title: 'Reliability Record', group: 'Maintenance', table: 'assets', numberCol: 'asset_no', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-preventive', title: 'Preventive Maintenance Plan', group: 'Maintenance', table: 'pm_plans', numberCol: 'plan_no', dateCol: 'created_at', statusCol: '', unitCol: 'unit_id' },
  { pageId: 'maint-schedule', title: 'Maintenance Schedule', group: 'Maintenance', table: 'pm_schedules', numberCol: 'generated_key', dateCol: 'due_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-breakdown', title: 'Breakdown Ticket', group: 'Maintenance', table: 'breakdown_tickets', numberCol: 'bd_no', dateCol: 'reported_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-workorders', title: 'Maintenance Work Order', group: 'Maintenance', table: 'maint_work_orders', numberCol: 'mwo_no', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-downtime', title: 'Downtime Record', group: 'Maintenance', table: 'downtime_events', numberCol: 'dt_no', dateCol: 'start_at', statusCol: '', unitCol: 'unit_id' },
  { pageId: 'maint-alerts', title: 'Maintenance Alert', group: 'Maintenance', table: 'alerts', numberCol: 'message', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'maint-spares', title: 'Spare Part', group: 'Maintenance', table: 'items', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'mfg-bom', title: 'Bill of Materials', group: 'Manufacturing', table: 'mfg_boms', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'mfg_bom_lines', fk: 'bom_id' } },
  { pageId: 'mfg-routing', title: 'Routing', group: 'Manufacturing', table: 'mfg_routings', numberCol: 'number', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'mfg_routing_ops', fk: 'routing_id' } },
  { pageId: 'mfg-workcenters', title: 'Work Center', group: 'Manufacturing', table: 'mfg_work_centres', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-plan', title: 'Production Plan', group: 'Manufacturing', table: 'mfg_production_plans', numberCol: 'number', dateCol: 'plan_date', statusCol: 'status', unitCol: 'unit_id', lines: { table: 'mfg_production_plan_lines', fk: 'plan_id' } },
  { pageId: 'mfg-wip', title: 'WIP Statement', group: 'Manufacturing', table: 'mfg_orders', numberCol: 'number', dateCol: 'start_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-unit-route', title: 'Plant Route Sheet', group: 'Manufacturing', table: 'mfg_orders', numberCol: 'number', dateCol: 'start_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-fg', title: 'Finished Goods Receipt', group: 'Manufacturing', table: 'mfg_production_receipts', numberCol: 'number', dateCol: 'receipt_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-scrap', title: 'Scrap Note', group: 'Manufacturing', table: 'mfg_scrap', numberCol: 'number', dateCol: 'scrap_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-rework', title: 'Rework Order', group: 'Manufacturing', table: 'mfg_rework', numberCol: 'number', dateCol: 'rework_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-ecn', title: 'Engineering Change Order', group: 'Manufacturing', table: 'engineering_change_orders', numberCol: 'number', dateCol: 'created_at', statusCol: '', unitCol: 'unit_id' },
  { pageId: 'mfg-transfer-note', title: 'Material Transfer Note', group: 'Manufacturing', table: 'transfer_notes', numberCol: 'note_no', dateCol: 'transfer_date', statusCol: 'receipt_status', unitCol: 'unit_id' },
  { pageId: 'flow-bom-approval', title: 'BOM and Material Approval', group: 'Manufacturing', table: 'bom_material_flows', numberCol: 'flow_no', dateCol: 'created_at', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'plant-unit-routing', title: 'Plant Route', group: 'Manufacturing', table: 'plant_routes', numberCol: 'code', dateCol: 'created_at', statusCol: '', unitCol: null },
  { pageId: 'qms-supplier', title: 'Supplier Quality Record', group: 'Quality', table: 'suppliers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'mfg-mrp', title: 'MRP Suggestion', group: 'Manufacturing', table: 'mfg_mrp_suggestions', numberCol: 'type', dateCol: 'due_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'mfg-workorders', title: 'Job Card', group: 'Manufacturing', table: 'mfg_order_ops', numberCol: 'name', dateCol: 'started_at', statusCol: 'status', unitCol: null },
  { pageId: 'mfg-material-issue', title: 'Material Issue', group: 'Manufacturing', table: 'mfg_order_materials', numberCol: 'line_no', dateCol: 'order_id', statusCol: '', unitCol: null },
  { pageId: 'mfg-costing', title: 'Production Cost Sheet', group: 'Manufacturing', table: 'mfg_cost_sheets', numberCol: 'std_total', dateCol: 'updated_at', statusCol: '', unitCol: null },
  { pageId: 'sales-delivery', title: 'Delivery Plan', group: 'Sales', table: 'sales_orders', numberCol: 'number', dateCol: 'order_date', statusCol: 'status', unitCol: 'unit_id' },
  { pageId: 'sales-credit', title: 'Credit Limit', group: 'Sales', table: 'customers', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'fin-trial', title: 'Trial Balance Account', group: 'Finance', table: 'accounts', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'fin-pnl', title: 'Profit and Loss Line', group: 'Finance', table: 'accounts', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'fin-bs', title: 'Balance Sheet Line', group: 'Finance', table: 'accounts', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
  { pageId: 'fin-cashflow', title: 'Cash Flow Line', group: 'Finance', table: 'accounts', numberCol: 'code', dateCol: 'created_at', statusCol: 'status', unitCol: null },
];

/** The table-backed document of a page: a Document Center type first, then a typed master / register page. */
export function printSourceOf(pageId: string): CatalogDoc | undefined {
  return CATALOG.find((c) => c.pageId === pageId) ?? TYPED_DOCS.find((c) => c.pageId === pageId);
}

const HIDE = /(^id$|_id$|^version$|^deleted_at$|^created_at$|^updated_at$|^fy_id$|^password|^json|_json$|^body_html$)/;

/** Screens that keep records in tables of their own (Finance, Quality, Maintenance, Manufacturing): their audit rows name the page. */
const OWN_SCREEN = /^(fin|qms|maint|mfg|plant|flow|quality)-/;
export function hasOwnRecords(pageId: string): boolean {
  return OWN_SCREEN.test(pageId) && !!printSourceOf(pageId);
}

export function catalogOf(pageId: string): CatalogDoc | undefined {
  return CATALOG.find((c) => c.pageId === pageId);
}

const STORED_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** The number a person knows a record by. A PM schedule row has none of its own: its plan number and due date name it. */
export async function readableNo(table: string, id: string, stored: string): Promise<string> {
  if (table !== 'pm_schedules' || !STORED_ID.test(stored)) return stored;
  const r = await query(prisma, `SELECT p.plan_no || '/' || to_char(s.due_date, 'YYYYMMDD') AS no FROM pm_schedules s JOIN pm_plans p ON p.id = s.plan_id WHERE s.id = $1::uuid`, id);
  return r[0]?.no ? String(r[0].no as string) : stored;
}

const fmtDate = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};
const pretty = (k: string): string => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function cell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Math.round(v).toLocaleString('en-IN');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v).trim();
  if (/^-?\d+\.\d+$/.test(s)) {
    const num = Number(s);
    if (!isNaN(num)) return Math.round(num).toLocaleString('en-IN');
  }
  return s;
}

/** The print model of a record of the catalog, built from its table row and its lines (every record prints). */
/** The names behind a row's links (customer, supplier, item, production order, machine), so a print says who and what. */
async function linkedNames(r: Row): Promise<{ facts: { label: string; value: string }[]; order: string }> {
  const links: [string, string, string][] = [
    ['customer_id', 'Customer', 'SELECT name AS label FROM customers WHERE id = $1::uuid'],
    ['supplier_id', 'Supplier', 'SELECT name AS label FROM suppliers WHERE id = $1::uuid'],
    ['vendor_id', 'Vendor', 'SELECT name AS label FROM suppliers WHERE id = $1::uuid'],
    ['item_id', 'Item', "SELECT code || ' - ' || name AS label FROM items WHERE id = $1::uuid"],
    ['asset_id', 'Machine / equipment', "SELECT asset_no || ' - ' || name AS label FROM assets WHERE id = $1::uuid"],
    ['order_id', 'Production order', 'SELECT number AS label FROM mfg_orders WHERE id = $1::uuid'],
  ];
  const facts: { label: string; value: string }[] = [];
  let order = '';
  for (const [column, label, sql] of links) {
    if (!r[column]) continue;
    const found = (await query(prisma, sql, String(r[column] as string)).catch(() => [] as Row[]))[0]?.label;
    if (!found) continue;
    facts.push({ label, value: String(found as string) });
    if (column === 'order_id') order = String(found as string);
  }
  return { facts, order };
}

async function rowDto(caller: Caller, doc: CatalogDoc, id: string): Promise<PrintDto> {
  const rows = await query(prisma, `SELECT t.* FROM ${doc.table} t WHERE t.id = $1::uuid`, id);
  const r = rows[0];
  if (!r) throw Errors.notFound('Record not found.');
  if (doc.unitCol && r[doc.unitCol] && !caller.ctx.unitIds.includes(String(r[doc.unitCol]))) throw Errors.notFound('Record not found.');
  const unitId = doc.unitCol ? String(r[doc.unitCol] ?? '') : '';
  const unit = unitId ? await prisma.unit.findUnique({ where: { id: unitId } }) : null;
  const facts = Object.entries(r)
    .filter(([k, v]) => !HIDE.test(k) && k !== doc.numberCol && v !== null && v !== '' && (typeof v !== 'object' || v instanceof Date))
    .map(([k, v]) => ({ label: pretty(k), value: cell(v) }));
  let lines: PrintDto['lines'] = null;
  if (doc.lines) {
    const ls = await query(prisma, `SELECT l.*, i.name AS item_name FROM ${doc.lines.table} l LEFT JOIN items i ON i.id = l.item_id WHERE l.${doc.lines.fk} = $1::uuid ORDER BY l.created_at NULLS LAST, l.id`, id).catch(
      () => query(prisma, `SELECT l.* FROM ${doc.lines!.table} l WHERE l.${doc.lines!.fk} = $1::uuid`, id),
    );
    if (ls.length > 0) {
      const keys = Object.keys(ls[0]!).filter((k) => !HIDE.test(k) || k === 'item_name');
      lines = {
        columns: keys.map((k) => ({ key: k, label: pretty(k === 'item_name' ? 'item' : k), format: 'text', align: ls.some((x) => typeof x[k] === 'number' || /^-?\d+(\.\d+)?$/.test(String(x[k] ?? ''))) ? ('right' as const) : ('left' as const) })),
        rows: ls.map((x) => Object.fromEntries(keys.map((k) => {
          const val = x[k];
          if (val instanceof Date) return [k, fmtDate(val)];
          if (typeof val === 'number') return [k, Math.round(val).toLocaleString('en-IN')];
          if (typeof val === 'string' && /^-?\d+\.\d+$/.test(val.trim())) {
            const n = Number(val.trim());
            if (!isNaN(n)) return [k, Math.round(n).toLocaleString('en-IN')];
          }
          return [k, (val as string | number | null) ?? null];
        }))) as never,
      };
    }
  }
  const linked = await linkedNames(r);
  // a line of a production order (job card, material, cost sheet) is named after its order
  const rawNo = r[doc.numberCol] instanceof Date ? fmtDate(r[doc.numberCol]) : String((r[doc.numberCol] ?? id) as string);
  const docNo = LINE_TABLES.has(doc.table) && linked.order ? `${linked.order} / ${rawNo}` : await readableNo(doc.table, id, rawNo);
  const total = doc.totalCol && r[doc.totalCol] !== null && r[doc.totalCol] !== undefined ? Number(r[doc.totalCol]) : null;
  const created = r.created_by_id ? (await query(prisma, `SELECT name FROM users WHERE id = $1::uuid`, r.created_by_id))[0] : null;
  return {
    templateKey: 'row',
    title: doc.title,
    docNo,
    docDate: fmtDate(r[doc.dateCol] instanceof Date ? r[doc.dateCol] : (r.created_at ?? new Date())),
    unit: { code: unit?.code ?? '-', name: unit?.name ?? '-', ...(unit?.gstin ? { gstin: unit.gstin } : {}), ...(unit?.address ? { address: [unit.address, unit.city].filter(Boolean).join(', ') } : {}) },
    letterhead: {},
    parties: [],
    facts: [...(doc.statusCol ? [{ label: 'Status', value: String((r[doc.statusCol] ?? '') as string) }] : []), ...linked.facts, ...facts.filter((f) => f.label !== 'Status')],
    lines,
    sections: [],
    totals: total !== null ? [{ label: 'Total', value: formatInr(total), bold: true }] : [],
    ...(total !== null ? { amountInWords: rupeesInWords(total) } : {}),
    signatures: [{ label: 'Prepared by', ...(created?.name ? { name: String(created.name) } : {}) }, { label: 'Checked by' }, { label: 'Approved by' }],
  };
}

const LINE_TABLES: ReadonlySet<string> = new Set(['mfg_order_ops', 'mfg_order_materials', 'mfg_cost_sheets', 'mfg_mrp_suggestions']);

const POSTED = /^(posted|approved|issued|released|closed|accepted|active|pass)$/i;

/** Builds the model once: typed print builder first, then the generic record, then the table row of the catalog. */
export async function buildPrintDto(caller: Caller, pageId: string, id: string): Promise<{ dto: PrintDto; status: string }> {
  const user = accessUserOf(caller.auth.user);
  if (!(await can(user, pageId, 'view'))) throw Errors.forbidden();
  if (pageId === 'hr-offer-letter') {
    const l = (await query(prisma, `SELECT * FROM issued_letters WHERE id = $1::uuid`, id))[0];
    if (!l || !caller.ctx.unitIds.includes(String(l.unit_id))) throw Errors.notFound('Letter not found.');
    const unit = await prisma.unit.findUnique({ where: { id: String(l.unit_id) } });
    const dto: PrintDto = {
      templateKey: 'letter', title: String(l.template_code) === 'OFFER' ? 'Offer Letter' : 'Appointment Letter', docNo: String(l.number), docDate: fmtDate(l.created_at),
      unit: { code: unit?.code ?? '-', name: unit?.name ?? '-', ...(unit?.gstin ? { gstin: unit.gstin } : {}) }, letterhead: {}, parties: [{ role: 'To', name: String(l.person_name) }],
      facts: [{ label: 'Status', value: String(l.status) }], lines: null, sections: [{ title: '', text: stripHtml(String(l.body_html)) }], totals: [], signatures: [{ label: 'Authorised signatory' }],
    };
    return { dto, status: String(l.status) };
  }
  const doc = printSourceOf(pageId);
  if (doc) {
    const dto = await rowDto(caller, doc, id);
    return { dto, status: dto.facts.find((f) => f.label === 'Status')?.value ?? '' };
  }
  const key = typedSchema(pageId)?.printTemplates?.find((t) => t.kind === 'web')?.key;
  const builder = key ? getPrintDataBuilder(pageId, key) : undefined;
  if (builder) {
    const dto = await builder({ db: prisma, caller, pageId, id });
    return { dto, status: dto.facts.find((f) => f.label === 'Status')?.value ?? '' };
  }
  const dto = await recordPdfService.recordPrintDto(caller, pageId, id);
  return { dto, status: dto.facts.find((f) => f.label === 'Status')?.value ?? '' };
}

/** "Original" the first time a posted document is printed, "Duplicate" after that; a draft is marked DRAFT. */
async function copyLabel(id: string, status: string, requested?: string): Promise<string> {
  if (!POSTED.test(status)) return 'DRAFT';
  if (requested === 'original') return 'Original';
  if (requested === 'duplicate') return 'Duplicate';
  const n = Number((await query(prisma, `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PRINT_RENDERED' AND target_id = $1 AND detail->>'copy' IN ('Original','Duplicate')`, id).catch(() => [{ n: 0 }]))[0]?.n ?? 0);
  return n > 0 ? 'Duplicate' : 'Original';
}

// ------------------------------------------------------------------------------------------ adapters
export async function wordOf(dto: PrintDto, copy: string): Promise<Buffer> {
  // docx 8 is an ES module: it is loaded with a dynamic import() from this CommonJS build.
  // The package ships ES-module typings that this CommonJS build cannot resolve, so the module is used untyped.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
  const { AlignmentType, Document, Footer, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = (await import('docx')) as any;
  const cellP = (text: string, bold = false) =>
    new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
  const kids: any[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: dto.title, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `${dto.docNo}  ·  ${dto.docDate}  ·  ${dto.unit.name} (${dto.unit.code})  ·  ${copy}`, size: 20 })] }),
  ];
  for (const p of dto.parties) kids.push(new Paragraph({ children: [new TextRun({ text: `${p.role}: `, bold: true }), new TextRun(`${p.name}${p.gstin ? `  GSTIN ${p.gstin}` : ''}${p.address ? `  ${p.address}` : ''}`)] }));
  if (dto.facts.length > 0) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Details')] }));
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: dto.facts.map((f) => new TableRow({ children: [cellP(f.label, true), cellP(f.value)] })) }));
  }
  if (dto.lines && dto.lines.rows.length > 0) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Lines')] }));
    kids.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: dto.lines.columns.map((c) => cellP(c.label, true)) }),
          ...dto.lines.rows.map((r) => new TableRow({ children: dto.lines!.columns.map((c) => cellP(r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]))) })),
        ],
      }),
    );
  }
  for (const s of dto.sections) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(s.title)] }));
    if (s.text) kids.push(new Paragraph(s.text));
    for (const r of s.rows ?? []) kids.push(new Paragraph({ children: [new TextRun({ text: `${r.label}: `, bold: true }), new TextRun(r.value)] }));
  }
  for (const t of dto.totals) kids.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${t.label}: ${t.value}`, bold: t.bold === true })] }));
  if (dto.amountInWords) kids.push(new Paragraph({ children: [new TextRun({ text: dto.amountInWords, italics: true })] }));
  if (dto.notes) kids.push(new Paragraph(dto.notes));
  kids.push(new Paragraph({ spacing: { before: 600 }, children: [new TextRun(dto.signatures.map((s) => `${s.label}: ${s.name ?? '________________'}`).join('        '))] }));
  const doc = new Document({
    creator: 'ERP',
    title: dto.title,
    sections: [{ children: kids, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Uncontrolled copy', italics: true, size: 16 })] })] }) } }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
}

export async function excelOf(dto: PrintDto, copy: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const head = wb.addWorksheet('Header');
  head.columns = [{ header: 'Field', key: 'k', width: 28 }, { header: 'Value', key: 'v', width: 60 }];
  head.addRows([
    { k: 'Document', v: dto.title }, { k: 'Number', v: dto.docNo }, { k: 'Date', v: dto.docDate }, { k: 'Plant', v: `${dto.unit.name} (${dto.unit.code})` }, { k: 'Copy', v: copy },
    ...dto.parties.map((p) => ({ k: p.role, v: p.name })),
    ...dto.facts.map((f) => ({ k: f.label, v: f.value })),
    ...dto.totals.map((t) => ({ k: t.label, v: t.value })),
  ]);
  head.getRow(1).font = { bold: true };
  const ls = wb.addWorksheet('Lines');
  if (dto.lines && dto.lines.rows.length > 0) {
    ls.columns = dto.lines.columns.map((c) => ({ header: c.label, key: c.key, width: 18 }));
    for (const r of dto.lines.rows) ls.addRow(r);
  } else {
    ls.addRow(['This document has no lines.']);
  }
  ls.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function renderPrint(caller: Caller, pageId: string, id: string, kind: PrintKind, copyParam?: string): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const { dto, status } = await buildPrintDto(caller, pageId, id);
  // Phase 31: the custom fields switched on for PDF / Excel
  dto.facts = [...dto.facts, ...(await controlService.printFacts(pageId, id, kind === 'excel' ? 'excel' : 'pdf'))];
  const copy = await copyLabel(id, status, copyParam);
  const labelled: PrintDto = { ...dto, title: copy === 'DRAFT' ? `DRAFT - ${dto.title}` : `${dto.title} (${copy})` };
  const base = `${dto.title.replace(/[^A-Za-z0-9]+/g, '-')}-${dto.docNo.replace(/[^A-Za-z0-9]+/g, '-')}`;
  let buffer: Buffer;
  let contentType: string;
  let ext: string;
  if (kind === 'word') {
    buffer = await wordOf(dto, copy);
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    ext = 'docx';
  } else if (kind === 'excel') {
    buffer = await excelOf(dto, copy);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    ext = 'xlsx';
  } else {
    const { lh, logo } = await letterheadFor();
    // STANDARD: plain header; LETTERHEAD / COMMERCIAL: the plant letterhead with GSTIN and PAN
    const header: PdfLetterhead = kind === 'standard' ? { ...lh, address: null, phone: null, email: null, showGstin: false, showPan: false } : lh;
    buffer = await renderDocumentPdf(labelled, header, { logo: kind === 'standard' ? null : logo });
    contentType = 'application/pdf';
    ext = 'pdf';
  }
  await recordAudit({ action: 'PRINT_RENDERED', actorId: caller.auth.userId, targetType: 'record', targetId: id, meta: caller.meta, detail: { pageId, code: dto.docNo, kind, copy, ...(caller.ctx.unitId ? { unitId: caller.ctx.unitId } : {}) } });
  return { buffer, contentType, filename: `${base}.${ext}` };
}

export interface CatalogEntry { pageId: string; title: string; group: string; count: number }

export async function catalogCounts(caller: Caller): Promise<CatalogEntry[]> {
  const out: CatalogEntry[] = [];
  for (const d of CATALOG) {
    const where = d.unitCol ? `WHERE ${d.unitCol} = ANY($1::uuid[])` : '';
    const n = await query(prisma, `SELECT count(*)::int AS n FROM ${d.table} ${where}`, ...(d.unitCol ? [caller.ctx.unitIds] : [])).catch(() => [{ n: 0 }]);
    out.push({ pageId: d.pageId, title: d.title, group: d.group, count: Number(n[0]?.n ?? 0) });
  }
  return out;
}

export async function catalogRecords(caller: Caller, pageId: string, q: string): Promise<Row[]> {
  const d = catalogOf(pageId);
  if (!d) throw Errors.notFound('Unknown document type.');
  const user = accessUserOf(caller.auth.user);
  if (!(await can(user, pageId, 'view'))) throw Errors.forbidden();
  const unit = d.unitCol ? `AND ${d.unitCol} = ANY($1::uuid[])` : 'AND $1::uuid[] IS NOT NULL';
  return query(prisma, `SELECT id, ${d.numberCol}::text AS number, ${d.statusCol}::text AS status, ${d.dateCol} AS date FROM ${d.table} WHERE ($2 = '' OR ${d.numberCol}::text ILIKE $3) ${unit} ORDER BY ${d.dateCol} DESC NULLS LAST LIMIT 30`, caller.ctx.unitIds, q, `%${q}%`);
}
