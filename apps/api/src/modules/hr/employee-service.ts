// apps/api/src/modules/hr/employee-service.ts
// Employee Core: directory, profile, identity vault, assignments, PII reveals.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import {
  TX,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { recordAudit } from '../../core/audit/audit-service';
import {
  decryptAadhaar,
  decryptBank,
  encryptAadhaar,
  validateVerhoeff,
} from './hr-crypto';

export interface EmployeeInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  gender: string;
  dob: string;
  maritalStatus?: string | null;
  mobile: string;
  personalEmail?: string | null;
  officialEmail?: string | null;
  workerCategory?: 'WORKER' | 'STAFF';
  employmentTypeCode?: string;
  joiningDate: string;
  confirmationDate?: string | null;
  probationEnd?: string | null;
  biometricCode?: string | null;
  pan?: string | null;
  aadhaar?: string | null;
  uan?: string | null;
  esicIp?: string | null;
  pfApplicable?: boolean;
  esicApplicable?: boolean;
  bloodGroup?: string | null;
  presentAddress?: Record<string, unknown> | null;
  permanentAddress?: Record<string, unknown> | null;
  noticeDays?: number;
  lawBasisCode?: string;
  contractorName?: string | null;
  unitId: string;
  department: string;
  designationId?: string | null;
  costCentre?: string | null;
  reportingManagerEmployeeId?: string | null;
  grade?: string | null;
}

export class EmployeeService {
  async list(
    caller: Caller,
    params: {
      q?: string;
      unitId?: string;
      department?: string;
      status?: string;
      page?: number;
      size?: number;
    },
  ): Promise<{ rows: Row[]; total: number }> {
    const page = params.page ?? 1;
    const size = params.size ?? 25;
    const offset = (page - 1) * size;

    const conds: string[] = ['e.deleted_at IS NULL'];
    const args: unknown[] = [];

    if (params.status) {
      args.push(params.status);
      conds.push(`e.status = $${args.length}`);
    } else {
      conds.push(`e.status != 'SEPARATED'`);
    }

    if (params.unitId) {
      args.push(params.unitId);
      conds.push(`a.unit_id = $${args.length}::uuid`);
    }

    if (params.department) {
      args.push(params.department);
      conds.push(`a.department = $${args.length}`);
    }

    if (params.q) {
      args.push(`%${params.q.trim()}%`);
      const p = `$${args.length}`;
      conds.push(`(e.emp_code ILIKE ${p} OR e.first_name ILIKE ${p} OR e.last_name ILIKE ${p} OR e.mobile ILIKE ${p})`);
    }

    const where = conds.join(' AND ');

    const countSql = `
      SELECT COUNT(DISTINCT e.id)::int AS count
      FROM employees e
      LEFT JOIN employee_assignments a ON a.employee_id = e.id AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
      WHERE ${where}
    `;
    const total = ((await query(prisma, countSql, ...args))[0]?.count as number) ?? 0;

    args.push(size, offset);
    const sql = `
      SELECT DISTINCT ON (e.id)
        e.id, e.emp_code, e.first_name, e.middle_name, e.last_name, e.gender, e.dob,
        e.marital_status, e.mobile, e.official_email, e.employment_type_code,
        e.worker_category, e.joining_date, e.status, e.biometric_code, e.pan,
        e.aadhaar_last4, e.uan, e.esic_ip, e.pf_applicable, e.esic_applicable,
        e.blood_group, e.version, e.created_at,
        a.unit_id, u.name AS unit_name, a.department, a.designation_id, d.name AS designation_name,
        a.reporting_manager_employee_id
      FROM employees e
      LEFT JOIN employee_assignments a ON a.employee_id = e.id AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
      LEFT JOIN units u ON u.id = a.unit_id
      LEFT JOIN designations d ON d.id = a.designation_id
      WHERE ${where}
      ORDER BY e.id, a.effective_from DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}
    `;

    const raw = await query(prisma, sql, ...args);
    return { rows: raw.map(norm), total };
  }

  async get(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT e.*, a.unit_id, u.name AS unit_name, a.department, a.designation_id, d.name AS designation_name,
              a.reporting_manager_employee_id, m.first_name || ' ' || m.last_name AS manager_name
       FROM employees e
       LEFT JOIN employee_assignments a ON a.employee_id = e.id AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
       LEFT JOIN units u ON u.id = a.unit_id
       LEFT JOIN designations d ON d.id = a.designation_id
       LEFT JOIN employees m ON m.id = a.reporting_manager_employee_id
       WHERE e.id = $1::uuid AND e.deleted_at IS NULL
       ORDER BY a.effective_from DESC LIMIT 1`,
      id,
    );
    if (!rows[0]) throw Errors.notFound('Employee not found.');
    return norm(rows[0]);
  }

  async create(caller: Caller, input: EmployeeInput): Promise<Row> {
    const dupMobile = await query(
      prisma,
      `SELECT emp_code FROM employees WHERE mobile = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
      input.mobile,
    );
    if (dupMobile[0]) {
      throw Errors.validation({
        mobile: `This mobile is already used by active employee ${dupMobile[0].emp_code}`,
      });
    }

    if (input.biometricCode) {
      const dupBio = await query(
        prisma,
        `SELECT emp_code FROM employees WHERE biometric_code = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
        input.biometricCode,
      );
      if (dupBio[0]) {
        throw Errors.conflict(`This biometric code is already used by active employee ${dupBio[0].emp_code}`);
      }
    }

    if (input.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(input.pan)) {
      throw Errors.validation({ pan: 'PAN must look like ABCDE1234F' });
    }

    let aadhaarLast4: string | null = null;
    if (input.aadhaar) {
      const cleanAadhaar = input.aadhaar.replace(/\s+/g, '');
      if (!validateVerhoeff(cleanAadhaar)) {
        throw Errors.validation({ aadhaar: 'Aadhaar number must be 12 digits (Verhoeff check failed)' });
      }
      aadhaarLast4 = cleanAadhaar.slice(-4);
    }

    return await prisma.$transaction(
      async (tx) => {
        const fy = await fyOfCaller(caller);
        const empCode = await NumberingService.allocate(tx, {
          pageId: 'hr-employees',
          unitId: input.unitId,
          fyId: fy.id,
          prefix: 'EMP',
        });

        const employeeId = await insertRow(tx, 'employees', {
          empCode,
          firstName: input.firstName,
          middleName: input.middleName ?? null,
          lastName: input.lastName,
          gender: input.gender,
          dob: input.dob,
          maritalStatus: input.maritalStatus ?? null,
          mobile: input.mobile,
          personalEmail: input.personalEmail ?? null,
          officialEmail: input.officialEmail ?? null,
          employmentTypeCode: input.employmentTypeCode ?? 'PERMANENT',
          workerCategory: input.workerCategory ?? 'STAFF',
          joiningDate: input.joiningDate,
          confirmationDate: input.confirmationDate ?? null,
          probationEnd: input.probationEnd ?? null,
          status: 'ACTIVE',
          biometricCode: input.biometricCode ?? null,
          pan: input.pan ?? null,
          aadhaarLast4,
          uan: input.uan ?? null,
          esicIp: input.esicIp ?? null,
          pfApplicable: input.pfApplicable ?? true,
          esicApplicable: input.esicApplicable ?? false,
          bloodGroup: input.bloodGroup ?? null,
          presentAddress: input.presentAddress ? JSON.stringify(input.presentAddress) : null,
          permanentAddress: input.permanentAddress ? JSON.stringify(input.permanentAddress) : null,
          noticeDays: input.noticeDays ?? 30,
          lawBasisCode: input.lawBasisCode ?? 'FACTORIES_ACT',
          contractorName: input.contractorName ?? null,
          createdById: caller.auth.userId,
        });

        if (input.aadhaar) {
          const enc = encryptAadhaar(input.aadhaar.replace(/\s+/g, ''));
          await insertRow(tx, 'employee_identity_vault', {
            employeeId,
            aadhaarEnc: enc,
            keyVersion: 1,
            updatedById: caller.auth.userId,
          });
        }

        await insertRow(tx, 'employee_assignments', {
          employeeId,
          effectiveFrom: input.joiningDate,
          effectiveTo: null,
          unitId: input.unitId,
          department: input.department,
          designationId: input.designationId ?? null,
          costCentre: input.costCentre ?? null,
          reportingManagerEmployeeId: input.reportingManagerEmployeeId ?? null,
          grade: input.grade ?? null,
          reason: 'JOIN',
          createdById: caller.auth.userId,
        });

        if (input.biometricCode) {
          await exec(
            tx,
            `UPDATE attendance_punch_exceptions
             SET resolved_employee_id = $1::uuid, resolved_at = now()
             WHERE biometric_code = $2 AND resolved_employee_id IS NULL`,
            employeeId,
            input.biometricCode,
          );
        }

        await recordAudit({
          action: 'RECORD_CREATED',
          actorId: caller.auth.userId,
          targetType: 'Employee',
          targetId: employeeId,
          detail: { empCode },
        }, tx);

        const created = (await query(tx, `SELECT * FROM employees WHERE id = $1::uuid`, employeeId))[0]!;
        return norm(created);
      },
      TX,
    );
  }

  async updateBiometricCode(caller: Caller, employeeId: string, biometricCode: string | null): Promise<void> {
    if (biometricCode) {
      const dup = await query(
        prisma,
        `SELECT emp_code FROM employees WHERE biometric_code = $1 AND id != $2::uuid AND status = 'ACTIVE' AND deleted_at IS NULL`,
        biometricCode,
        employeeId,
      );
      if (dup[0]) {
        throw Errors.conflict(`This biometric code is already used by active employee ${dup[0].emp_code}`);
      }
    }

    await prisma.$transaction(async (tx) => {
      await exec(
        tx,
        `UPDATE employees SET biometric_code = $1, updated_at = now(), updated_by_id = $2::uuid WHERE id = $3::uuid`,
        biometricCode,
        caller.auth.userId,
        employeeId,
      );

      if (biometricCode) {
        await exec(
          tx,
          `UPDATE attendance_punch_exceptions
           SET resolved_employee_id = $1::uuid, resolved_at = now()
           WHERE biometric_code = $2 AND resolved_employee_id IS NULL`,
          employeeId,
          biometricCode,
        );
      }

      await recordAudit({
        action: 'RECORD_UPDATED',
        actorId: caller.auth.userId,
        targetType: 'Employee',
        targetId: employeeId,
        detail: { biometricCode },
      }, tx);
    });
  }

  async addAssignment(
    caller: Caller,
    employeeId: string,
    data: {
      effectiveFrom: string;
      effectiveTo?: string | null;
      unitId: string;
      department: string;
      designationId?: string | null;
      costCentre?: string | null;
      reportingManagerEmployeeId?: string | null;
      grade?: string | null;
      reason: string;
      remarks?: string | null;
    },
  ): Promise<Row> {
    if (data.reportingManagerEmployeeId) {
      if (data.reportingManagerEmployeeId === employeeId) {
        throw Errors.conflict('This manager reports (directly or indirectly) to this employee');
      }
      const cycle = await query(
        prisma,
        `WITH RECURSIVE mgr_tree AS (
           SELECT reporting_manager_employee_id FROM employee_assignments
           WHERE employee_id = $1::uuid AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
           UNION ALL
           SELECT a.reporting_manager_employee_id FROM employee_assignments a
           JOIN mgr_tree t ON a.employee_id = t.reporting_manager_employee_id
           WHERE (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
         )
         SELECT 1 FROM mgr_tree WHERE reporting_manager_employee_id = $2::uuid`,
        data.reportingManagerEmployeeId,
        employeeId,
      );
      if (cycle[0]) {
        throw Errors.conflict('This manager reports (directly or indirectly) to this employee');
      }
    }

    return await prisma.$transaction(async (tx) => {
      await exec(
        tx,
        `UPDATE employee_assignments
         SET effective_to = ($1::date - INTERVAL '1 day')::date
         WHERE employee_id = $2::uuid AND (effective_to IS NULL OR effective_to >= $1::date)`,
        data.effectiveFrom,
        employeeId,
      );

      const asgnId = await insertRow(tx, 'employee_assignments', {
        employeeId,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        unitId: data.unitId,
        department: data.department,
        designationId: data.designationId ?? null,
        costCentre: data.costCentre ?? null,
        reportingManagerEmployeeId: data.reportingManagerEmployeeId ?? null,
        grade: data.grade ?? null,
        reason: data.reason,
        remarks: data.remarks ?? null,
        createdById: caller.auth.userId,
      });

      await recordAudit({
        action: 'RECORD_UPDATED',
        actorId: caller.auth.userId,
        targetType: 'Employee',
        targetId: employeeId,
        detail: { assignmentId: asgnId },
      }, tx);

      const row = (await query(tx, `SELECT * FROM employee_assignments WHERE id = $1::uuid`, asgnId))[0]!;
      return norm(row);
    });
  }

  async revealSensitive(
    caller: Caller,
    employeeId: string,
    field: 'aadhaar' | 'bankAccount',
    purpose: string,
  ): Promise<{ value: string }> {
    if (!purpose || purpose.trim().length < 5) {
      throw Errors.validation({ purpose: 'State a reason of at least 5 characters for viewing sensitive information.' });
    }

    await insertRow(prisma, 'pii_access_log', {
      userId: caller.auth.userId,
      employeeId,
      field,
      purpose,
      ip: caller.meta?.ip ?? null,
    });

    if (field === 'aadhaar') {
      const row = (
        await query(
          prisma,
          `SELECT aadhaar_enc FROM employee_identity_vault WHERE employee_id = $1::uuid`,
          employeeId,
        )
      )[0];
      if (!row) throw Errors.notFound('Aadhaar not found.');
      return { value: decryptAadhaar(row.aadhaar_enc as string) };
    }

    if (field === 'bankAccount') {
      const row = (
        await query(
          prisma,
          `SELECT account_enc FROM employee_bank_accounts WHERE employee_id = $1::uuid AND is_primary = true`,
          employeeId,
        )
      )[0];
      if (!row) throw Errors.notFound('Bank account not found.');
      return { value: decryptBank(row.account_enc as string) };
    }

    throw Errors.badRequest('Unknown sensitive field.');
  }
}

export const employeeService = new EmployeeService();
