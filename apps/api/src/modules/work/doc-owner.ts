// Which department holds a document that has no workflow rule and no stored department: the department column of its own
// table when it has one (doc-sources), otherwise the department of the page's family (Sales page -> Sales, GRN -> Purchase...).
import { pageInfo } from '../../core/registry';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import { DOC_SOURCES } from './doc-sources';

const IDENT = /^[a-z_][a-z0-9_]*$/;

const FAMILY_DEPT: Record<string, string> = {
  CRM: 'Sales',
  Sales: 'Sales',
  'Procurement / SCM': 'Purchase',
  Inventory: 'Warehouse',
  'Warehouse / WMS': 'Warehouse',
  'Logistics / Fleet': 'Warehouse',
  Manufacturing: 'Production',
  'Quality / QMS': 'Quality',
  Maintenance: 'Maintenance',
  Assets: 'Maintenance',
  'Finance & Accounts': 'Finance',
  'Indian Taxation': 'Finance',
  HRMS: 'HR',
  Payroll: 'HR',
  'Contract Labour Management': 'HR',
  'Workplace Management': 'HR',
  Projects: 'Projects',
  'Service / Support': 'Service',
};

type Tx = Parameters<typeof query>[0];

/** The id of the department that owns the document, or null when nothing says. */
export async function derivedOwnerDepartment(tx: Tx, docType: string, docId: string): Promise<string | null> {
  let name: string | null = null;
  const src = DOC_SOURCES.get(docType);
  if (src?.deptCol && IDENT.test(src.deptCol) && IDENT.test(src.table)) {
    const rows: Row[] = await query(tx, `SELECT ${src.deptCol}::text AS d FROM ${src.table} WHERE id = $1::uuid`, docId);
    name = rows[0]?.d ? String(rows[0].d) : null;
  }
  if (!name) name = FAMILY_DEPT[pageInfo(docType)?.family ?? ''] ?? 'Administration';
  const dep = (await query(tx, `SELECT id::text AS id FROM departments WHERE lower(name) = lower($1) LIMIT 1`, name))[0];
  return dep ? String(dep.id) : null;
}
