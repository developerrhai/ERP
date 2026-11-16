// apps/api/src/core/seed/work-movements-seed.ts
// Seeds realistic department work movements and internal messages if tables are empty.

import type { PrismaClient } from '@prisma/client';
import { query } from '../../modules/procurement/core';

export async function seedWorkMovementsDefaults(prisma: PrismaClient): Promise<{ movements: number; messages: number }> {
  const countRow = (await query(prisma, `SELECT count(*)::int AS n FROM work_movements`))[0];
  const movementCount = Number(countRow?.n ?? 0);

  const units = await query(prisma, `SELECT id::text AS id FROM units ORDER BY code LIMIT 1`);
  const unitId = units[0]?.id;
  if (!unitId) return { movements: 0, messages: 0 };

  const adminUsers = await query(prisma, `SELECT id::text AS id FROM users ORDER BY created_at LIMIT 1`);
  const userId = adminUsers[0]?.id;
  if (!userId) return { movements: 0, messages: 0 };

  const depts = await query(prisma, `SELECT id::text AS id, name FROM departments`);
  const deptMap: Record<string, string> = {};
  for (const d of depts) {
    deptMap[String(d.name).toLowerCase()] = String(d.id);
  }

  let movementsInserted = 0;
  {
    const rawMoves = [
      // HR Movements
      {
        num: 'MOV/2026/0841',
        docType: 'cand-offer',
        docNo: 'CAND-2026-0042',
        from: 'administration',
        to: 'hr',
        state: 'WAITING_APPROVAL',
        route: 'Department Work Handover',
        workStatus: 'Review Required',
        priority: 'High',
        note: 'Senior CNC Tooling Engineer offer package approved by CEO; HR release and compensation signoff requested.',
        daysAgo: 1,
      },
      {
        num: 'MOV/2026/0839',
        docType: 'hr-leave',
        docNo: 'LV-2026-0814',
        from: 'production',
        to: 'hr',
        state: 'SENT',
        route: 'Department Work Handover',
        workStatus: 'Work Required',
        priority: 'Normal',
        note: 'Machinist shift team medical certificate submitted for 14-day sick leave endorsement and ESIC claim.',
        daysAgo: 1,
      },
      {
        num: 'MOV/2026/0835',
        docType: 'pay-processing',
        docNo: 'PAY-RUN-NOV26',
        from: 'finance',
        to: 'hr',
        state: 'RECEIVED',
        route: 'Finance',
        workStatus: 'Work Required',
        priority: 'High',
        note: 'Shift punch logs and biometric discrepancies verified for 280 plant workmen; awaiting HR acceptance.',
        daysAgo: 2,
      },
      {
        num: 'MOV/2026/0828',
        docType: 'hr-appraisal',
        docNo: 'APP-2026-118',
        from: 'quality',
        to: 'hr',
        state: 'ACCEPTED',
        route: 'Department Work Handover',
        workStatus: 'Review Required',
        priority: 'Normal',
        note: 'Quality inspection technicians annual skill matrix rating and increment band proposals under review.',
        daysAgo: 3,
      },
      {
        num: 'MOV/2026/0820',
        docType: 'cand-offer',
        docNo: 'CAND-2026-0038',
        from: 'hr',
        to: 'administration',
        state: 'IN_WORK',
        route: 'Department Work Handover',
        workStatus: 'Work Required',
        priority: 'Normal',
        note: 'Offer letter drafted and candidate acceptance received. Forwarding for director counter-signature.',
        daysAgo: 4,
      },
      {
        num: 'MOV/2026/0811',
        docType: 'hr-training',
        docNo: 'TRN-2026-092',
        from: 'quality',
        to: 'hr',
        state: 'RETURNED',
        route: 'Correction',
        workStatus: 'Correction Required',
        priority: 'Normal',
        note: 'Plant 1 assembly hall fire drill compliance list.',
        daysAgo: 5,
        returnReason: 'Requires attendance supervisor signoffs from Night Shift B team before certification.',
      },
      {
        num: 'MOV/2026/0798',
        docType: 'hr-claim',
        docNo: 'EXP-CLM-9021',
        from: 'finance',
        to: 'hr',
        state: 'COMPLETED',
        route: 'Commercial Action',
        workStatus: 'Work Required',
        priority: 'Normal',
        note: 'Outstation technical interview reimbursement processed and disbursed via direct NEFT.',
        daysAgo: 7,
      },

      // Sales Movements
      {
        num: 'MOV/2026/0741',
        docType: 'sales-orders',
        docNo: 'SO-2026-0182',
        from: 'production',
        to: 'sales',
        state: 'SENT',
        route: 'Commercial Action',
        workStatus: 'Dispatch Action Required',
        priority: 'High',
        note: 'Export Flanges order fabrication completed; commercial invoice and final shipping clearance requested.',
        daysAgo: 1,
      },
      {
        num: 'MOV/2026/0738',
        docType: 'sales-quotations',
        docNo: 'SQ-2026-0541',
        from: 'projects',
        to: 'sales',
        state: 'RECEIVED',
        route: 'Technical Work',
        workStatus: 'Review Required',
        priority: 'Normal',
        note: 'High Pressure Vessel supply proposal reviewed by engineering; client cost breakdown ready.',
        daysAgo: 2,
      },
      {
        num: 'MOV/2026/0730',
        docType: 'sales-dispatch',
        docNo: 'DISP-2026-0098',
        from: 'quality',
        to: 'sales',
        state: 'WAITING_APPROVAL',
        route: 'Quality Action',
        workStatus: 'Quality Check Required',
        priority: 'Critical',
        note: 'Pre-dispatch inspection report and mill test certificate awaiting VP Sales signoff.',
        daysAgo: 3,
      },
      {
        num: 'MOV/2026/0724',
        docType: 'sales-orders',
        docNo: 'SO-2026-0175',
        from: 'sales',
        to: 'production',
        state: 'ACCEPTED',
        route: 'Manufacturing Action',
        workStatus: 'Manufacturing Required',
        priority: 'High',
        note: 'Automotive Stamping Sub-assembly Batch in progress on CNC Press 3.',
        daysAgo: 4,
      },

      // Purchase Movements
      {
        num: 'MOV/2026/0541',
        docType: 'scm-pr',
        docNo: 'PR-2026-0412',
        from: 'production',
        to: 'purchase',
        state: 'SENT',
        route: 'Purchase',
        workStatus: 'Work Required',
        priority: 'High',
        note: 'Seamless Boiler Tubes 50mm Sch 40 urgently needed for line 2 boiler overhaul.',
        daysAgo: 1,
      },
      {
        num: 'MOV/2026/0538',
        docType: 'scm-comparison',
        docNo: 'CMP-2026-0028',
        from: 'purchase',
        to: 'finance',
        state: 'WAITING_APPROVAL',
        route: 'Commercial Action',
        workStatus: 'Review Required',
        priority: 'Critical',
        note: 'L1 Vendor Comparison Matrix for Heavy Forgings package awaiting commercial CFO signoff.',
        daysAgo: 2,
      },
      {
        num: 'MOV/2026/0531',
        docType: 'scm-po',
        docNo: 'PO-2026-0389',
        from: 'purchase',
        to: 'quality',
        state: 'RECEIVED',
        route: 'Purchase',
        workStatus: 'Review Required',
        priority: 'Normal',
        note: 'CNC Solid Carbide Milling Inserts delivery schedule and QC inspection protocol handoff.',
        daysAgo: 3,
      },
      {
        num: 'MOV/2026/0524',
        docType: 'scm-grn',
        docNo: 'GRN-2026-0219',
        from: 'warehouse',
        to: 'purchase',
        state: 'ACCEPTED',
        route: 'Material Action',
        workStatus: 'Quality Check Required',
        priority: 'Normal',
        note: 'Raw Bar Stock Inward Inspection batch 42; 22 tonnes unloaded at bay 3.',
        daysAgo: 4,
      },

      // Finance Movements
      {
        num: 'MOV/2026/0612',
        docType: 'scm-purchaseinvoice',
        docNo: 'PINV-2026-0941',
        from: 'purchase',
        to: 'finance',
        state: 'SENT',
        route: 'Finance',
        workStatus: 'Finance Action Required',
        priority: 'High',
        note: '3-Way Matching Invoice Clearance for JSW Coated Sheets (₹ 14,80,000) ready for booking.',
        daysAgo: 1,
      },
      {
        num: 'MOV/2026/0608',
        docType: 'fin-expenses',
        docNo: 'EXP-2026-0412',
        from: 'maintenance',
        to: 'finance',
        state: 'RECEIVED',
        route: 'Finance',
        workStatus: 'Finance Action Required',
        priority: 'Normal',
        note: 'Plant Maintenance Spares Capex Payment voucher and invoice dossier.',
        daysAgo: 2,
      },
      {
        num: 'MOV/2026/0599',
        docType: 'tax-gstr3b',
        docNo: 'GST-2026-11',
        from: 'finance',
        to: 'administration',
        state: 'WAITING_APPROVAL',
        route: 'Finance',
        workStatus: 'Review Required',
        priority: 'Critical',
        note: 'Monthly Output-Input Tax Credit Reconciliation and GSTR-3B return filing package.',
        daysAgo: 3,
      },

      // Production & Quality Movements
      {
        num: 'MOV/2026/0441',
        docType: 'mfg-mo',
        docNo: 'MO-2026-0742',
        from: 'engineering',
        to: 'production',
        state: 'SENT',
        route: 'Manufacturing Action',
        workStatus: 'Manufacturing Required',
        priority: 'High',
        note: 'Turbine Shaft Turning & Grinding 1500 RPM production order released to floor.',
        daysAgo: 1,
      },
      {
        num: 'MOV/2026/0438',
        docType: 'qms-inspection',
        docNo: 'QC-INSP-2026-0891',
        from: 'production',
        to: 'quality',
        state: 'SENT',
        route: 'Quality Action',
        workStatus: 'Quality Check Required',
        priority: 'High',
        note: 'First Piece Inspection — Impeller Casing casting batch clearance.',
        daysAgo: 1,
      },
    ];

    for (const m of rawMoves) {
      const fromDeptId = deptMap[m.from];
      const toDeptId = deptMap[m.to];
      if (!fromDeptId || !toDeptId) continue;

      const d = new Date(Date.now() - m.daysAgo * 86400000);
      const sentAt = d.toISOString();
      const receivedAt = m.state !== 'SENT' ? new Date(d.getTime() + 3600000).toISOString() : null;
      const acceptedAt = ['ACCEPTED', 'IN_WORK', 'WAITING_APPROVAL', 'COMPLETED'].includes(m.state)
        ? new Date(d.getTime() + 7200000).toISOString()
        : null;
      const completedAt = m.state === 'COMPLETED' ? new Date(d.getTime() + 18000000).toISOString() : null;
      const slaDue = new Date(d.getTime() + 48 * 3600000).toISOString();

      await query(
        prisma,
        `INSERT INTO work_movements (
          number, unit_id, doc_type, doc_id, doc_no,
          from_department_id, to_department_id, assigned_manager_id,
          route_type, priority, work_status, handover_note,
          state, sent_by_id, sent_at, received_at, accepted_at, completed_at,
          return_reason, sla_due_at, late, is_physical
        ) VALUES (
          $1, $2::uuid, $3, gen_random_uuid(), $4,
          $5::uuid, $6::uuid, $7::uuid,
          $8, $9, $10, $11,
          $12, $7::uuid, $13::timestamptz, $14::timestamptz, $15::timestamptz, $16::timestamptz,
          $17, $18::timestamptz, false, false
        ) ON CONFLICT (number) DO NOTHING`,
        m.num,
        unitId,
        m.docType,
        m.docNo,
        fromDeptId,
        toDeptId,
        userId,
        m.route,
        m.priority,
        m.workStatus,
        m.note,
        m.state,
        sentAt,
        receivedAt,
        acceptedAt,
        completedAt,
        m.returnReason ?? null,
        slaDue,
      );
      movementsInserted++;
    }
  }

  // Check internal messages
  const mailCountRow = (await query(prisma, `SELECT count(*)::int AS n FROM internal_messages`))[0];
  let messagesInserted = 0;
  if (Number(mailCountRow?.n ?? 0) === 0) {
    const messages = [
      {
        fromDept: 'Administration',
        toDept: 'HR',
        subject: 'HR Policy Revision 2026-Q4 — Gratuity & ESIC Revision Guidelines',
        body: 'Please find attached the revised guidelines covering updated statutory gratuity provisions and ESIC wage ceiling rules.',
        daysAgo: 1,
        attachments: [{ label: 'HR_Policy_2026_Q4.pdf', format: 'pdf' }],
      },
      {
        fromDept: 'HR',
        toDept: 'HR',
        subject: 'New Joinee Induction Schedule — Tool Room Machinists (Batch 8)',
        body: 'Induction training sessions starting Monday 9:00 AM in Training Hall A. All supervisors requested to release nominees.',
        daysAgo: 2,
        attachments: [{ label: 'Induction_Plan.pdf', format: 'pdf' }, { label: 'Checklist.xlsx', format: 'excel' }],
      },
      {
        fromDept: 'Sales',
        toDept: 'Production',
        subject: 'PO Amendment Request — Bharat Forge Ltd (Rate & Quantity Adjustment)',
        body: 'Customer requested 15% increase in batch delivery schedule for November. Expedited machining requested.',
        daysAgo: 1,
        attachments: [{ label: 'PO_AMD_6610.pdf', format: 'pdf' }],
      },
      {
        fromDept: 'Purchase',
        toDept: 'Quality',
        subject: 'Vendor Audit Non-conformance Resolution — Tata Steel Tubes Ltd',
        body: 'Supplier submitted corrective actions for wall thickness variance. Re-testing and lot release protocol attached.',
        daysAgo: 2,
        attachments: [{ label: 'Tata_Steel_Audit.pdf', format: 'pdf' }],
      },
      {
        fromDept: 'Finance',
        toDept: 'Administration',
        subject: 'Statutory Advance Tax Payment Q3 Challans & Board Presentation',
        body: 'Advance tax installment Q3 completed via corporate portal. Challan counterfoils attached for tax file.',
        daysAgo: 3,
        attachments: [{ label: 'Advance_Tax_Q3.pdf', format: 'pdf' }],
      },
    ];

    for (const msg of messages) {
      const createdD = new Date(Date.now() - msg.daysAgo * 86400000).toISOString();
      const res = await query(
        prisma,
        `INSERT INTO internal_messages (
          unit_id, from_user_id, from_department, to_department, to_user_ids, subject, body, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, ARRAY[$2::uuid], $5, $6, $7::timestamptz
        ) RETURNING id::text AS id`,
        unitId,
        userId,
        msg.fromDept,
        msg.toDept,
        msg.subject,
        msg.body,
        createdD,
      );
      const msgId = res[0]?.id;
      if (msgId && msg.attachments) {
        for (const att of msg.attachments) {
          await query(
            prisma,
            `INSERT INTO internal_message_attachments (message_id, label, format) VALUES ($1::uuid, $2, $3)`,
            msgId,
            att.label,
            att.format,
          );
        }
      }
      messagesInserted++;
    }
  }

  return { movements: movementsInserted, messages: messagesInserted };
}
