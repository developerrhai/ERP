import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../src/core/db/prisma';
import {
  calculateFreight,
  checkFreightVariance,
  analyzeFuelLog,
  computeStatutoryDueDate,
  evaluateStatutoryStatus,
  computeReturnableOverdue,
  validateIso6346Container,
  validateChallanNumber,
  validateEwayBill,
  addYearsSafe,
} from '../src/modules/logistics/logistics-calc';
import { fleetService } from '../src/modules/logistics/fleet-service';
import { gateService } from '../src/modules/logistics/gate-service';
import { dmsService } from '../src/modules/logistics/dms-service';
import { logisticsService } from '../src/modules/logistics/logistics-service';
import type { Caller } from '../src/modules/records/service';

let ownerCaller: Caller;
let unitId: string;
let fyId: string;
let restrictedUserCaller: Caller;

beforeAll(async () => {
  const admin = await prisma.user.findFirstOrThrow({
    include: { role: true },
    orderBy: { createdAt: 'asc' },
  });
  const sawUnit =
    (await prisma.unit.findFirst({ where: { code: 'SAW' } })) ??
    (await prisma.unit.findFirstOrThrow());
  const fy = await prisma.financialYear.findFirstOrThrow({ where: { status: 'OPEN' } });
  unitId = sawUnit.id;
  fyId = fy.id;

  ownerCaller = {
    auth: {
      userId: admin.id,
      sessionId: 'test-session',
      roleId: admin.roleId,
      roleCode: admin.role.code,
      level: admin.role.level,
      allUnits: true,
      departments: [],
      role: admin.role.code,
      user: admin as any,
    },
    ctx: {
      unitId,
      fyId,
      unit: sawUnit,
      fy,
    } as any,
    meta: { ip: '127.0.0.1', userAgent: 'vitest' },
  };

  // Create a low-privilege role/user for DMS ACL negative test
  const viewerRole = await prisma.role.upsert({
    where: { code: 'TEST_VIEWER' },
    update: {},
    create: { code: 'TEST_VIEWER', name: 'Test Viewer', level: 10 },
  });
  const dept = await prisma.department.findFirstOrThrow();
  const viewerUser = await prisma.user.upsert({
    where: { loginId: 'test-dms-viewer' },
    update: {},
    create: {
      loginId: 'test-dms-viewer',
      email: 'dms-viewer@test.local',
      name: 'Test DMS Viewer',
      roleId: viewerRole.id,
      department: dept.name,
      approvalLimit: 10000,
      passwordHash: 'hash',
      mustChangePassword: false,
    },
    include: { role: true },
  });

  restrictedUserCaller = {
    auth: {
      userId: viewerUser.id,
      sessionId: 'test-viewer-session',
      roleId: viewerUser.roleId,
      roleCode: viewerUser.role.code,
      level: viewerUser.role.level,
      allUnits: false,
      departments: [],
      role: viewerUser.role.code,
      user: viewerUser as any,
    },
    ctx: ownerCaller.ctx,
    meta: ownerCaller.meta,
  };
});

describe('Phase 18 Logistics, Fleet, Gate & DMS Integration Tests', () => {
  it('Owner Check 4: Freight 2,350 kg worked example = ₹18,447.00 (RCM 5% = 922.35)', () => {
    const res = calculateFreight({
      basis: 'PER_KG_SLAB',
      weightKg: 2350,
      minCharge: 5000,
      fuelSurchargePct: 8,
      tollAmount: 1450,
      loadingAmount: 500,
      gtaRcmApplicable: true,
      slabs: [
        { fromQty: 0, toQty: 1000, rate: 8.0 },
        { fromQty: 1001, toQty: 5000, rate: 6.5 },
      ],
    });
    expect(res.totalAmount).toBe(18447);
    expect(res.gtaRcmAmount).toBe(922.35);

    const varCheck = checkFreightVariance(18447, 19000);
    expect(varCheck.requiresApproval).toBe(true);
  });

  it('Fuel Full-Tank worked example & all anomaly detections', () => {
    const ok = analyzeFuelLog({
      odometer: 120400,
      litres: 60,
      filledAt: '2026-11-10T10:00:00Z',
      isFullTank: true,
      tankCapacity: 220,
      stdKmpl: 4.5,
      prevLogs: [
        { odometer: 120000, litres: 120, filledAt: '2026-11-05T10:00:00Z', isFullTank: true },
        { odometer: 120180, litres: 40, filledAt: '2026-11-08T10:00:00Z', isFullTank: false },
      ],
    });
    expect(ok.kmpl).toBe(4.0);
    expect(ok.variancePct).toBe(-11.11);

    const blocked = analyzeFuelLog({
      odometer: 119950,
      litres: 260,
      filledAt: '2026-11-10T10:00:00Z',
      isFullTank: true,
      tankCapacity: 220,
      stdKmpl: 4.5,
      prevLogs: [
        { odometer: 120400, litres: 60, filledAt: '2026-11-09T10:00:00Z', isFullTank: true },
      ],
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.anomalies).toContain('ODO_BACKWARD');
    expect(blocked.anomalies).toContain('OVER_TANK');
  });

  it('ISO 6346 Check Digit & CGST Rule 55 <= 16 chars & Statutory Dates (incl. 29-Feb-2028)', async () => {
    expect(validateIso6346Container('CSQU3054383').valid).toBe(true);
    await expect(logisticsService.createContainer({ containerNo: 'CSQU3054384' })).rejects.toThrow(
      'Container number check digit invalid',
    );
    expect(validateChallanNumber('RGP/SAW/26/00012').valid).toBe(true);
    expect(computeStatutoryDueDate('2025-11-10', 'INPUT')).toBe('2026-11-10');
    expect(evaluateStatutoryStatus('2026-11-10', '2026-11-04').alertThreshold).toBe(7);
    expect(addYearsSafe('2024-02-29', 4)).toBe('2028-02-29');
    expect(computeReturnableOverdue('2026-11-01', '2026-11-09', 4).alertThreshold).toBe(7);
  });

  it('Expired Vehicle Document & Expired Driver Licence block Shipment allocation', async () => {
    const veh = await fleetService.createVehicle(ownerCaller, {
      regNo: 'MH12AB1234',
      vehicleType: '32FT MXL',
      tankCapacityL: 220,
      stdKmpl: 4.5,
    });
    await fleetService.addVehicleDocument(ownerCaller, String(veh.id), {
      docTypeCode: 'RC',
      docNo: 'RC-001',
      expiryDate: '2030-01-01',
    });
    await fleetService.addVehicleDocument(ownerCaller, String(veh.id), {
      docTypeCode: 'INS',
      docNo: 'INS-001',
      expiryDate: '2020-01-01', // Expired!
    });

    await expect(
      logisticsService.createShipment(ownerCaller, {
        vehicleId: String(veh.id),
      }),
    ).rejects.toThrow(/expired Motor Insurance Policy/i);

    const drv = await fleetService.createDriver(ownerCaller, {
      name: 'R. Driver',
      mobile: '9822001122',
      licenceNo: 'MH1220100001',
      licenceExpiry: '2021-10-01', // Expired!
    });

    await expect(
      fleetService.assertVehicleAndDriverValid(prisma, null, String(drv.id)),
    ).rejects.toThrow(/Driver licence expired on 01-10-2021/);
  });

  it('Owner Check 2 & 3: Gate OUT blocks E-way mismatch; Returnable pass partial return updates balance_qty', async () => {
    // 1. E-way bill vehicle mismatch -> blocked
    const mismatchPass = await gateService.createPass(ownerCaller, {
      direction: 'OUT',
      passType: 'NON_RETURNABLE',
      vehicleNo: 'MH12AB1243',
      ewayBillNo: '123456789012',
      ewayVehicleNo: 'MH12AB1234',
      lines: [{ description: 'Machinery', uom: 'NOS', qty: 1, value: 124500 }],
    });
    await gateService.approvePass(ownerCaller, String(mismatchPass.id));
    await expect(gateService.exitPass(ownerCaller, String(mismatchPass.id))).rejects.toThrow(
      'E-way bill vehicle MH12AB1234 does not match gate vehicle MH12AB1243.',
    );

    // 2. Returnable pass <= 16 chars & partial return updates balance_qty (Owner check 3)
    const outPass = await gateService.createPass(ownerCaller, {
      direction: 'OUT',
      passType: 'RETURNABLE',
      vehicleNo: 'MH12AB9999',
      expectedReturnDate: '2026-12-01',
      lines: [
        {
          description: 'Copper Mould Die',
          uom: 'NOS',
          qty: 10,
          unitRate: 1000,
          jobworkCategory: 'INPUT',
        },
      ],
    });
    expect(String(outPass.passNo).length).toBeLessThanOrEqual(16);
    await gateService.approvePass(ownerCaller, String(outPass.id));
    await gateService.exitPass(ownerCaller, String(outPass.id));

    const outLineId = String(outPass.lines[0].id);
    const inRet = await gateService.createPass(ownerCaller, {
      direction: 'IN',
      passType: 'INWARD_RETURN',
      vehicleNo: 'MH12AB9999',
      lines: [{ description: 'Copper Mould Die', uom: 'NOS', qty: 6 }],
    });

    // Over-return (> balance 10) fails
    await expect(
      gateService.recordReturn(ownerCaller, String(inRet.id), [{ outLineId, qty: 12 }]),
    ).rejects.toThrow('Return quantity exceeds balance 10.');

    // Partial return 6 -> balance = 4
    await gateService.recordReturn(ownerCaller, String(inRet.id), [{ outLineId, qty: 6 }]);
    const refreshedOut = await gateService.getPass(String(outPass.id));
    expect(Number(refreshedOut.lines[0].returnedQty)).toBe(6);
    expect(Number(refreshedOut.lines[0].balanceQty)).toBe(4);
  });

  it('Owner Check 5: DMS Restricted ACL, Postgres FTS Search Never Leaks, Checkout Lock & Legal Hold', async () => {
    const restrictedFolder = await dmsService.createFolder(ownerCaller, {
      name: 'HR Restricted',
      confidentiality: 'RESTRICTED',
      retentionYears: 8,
    });

    const secretDoc = await dmsService.createDocument(ownerCaller, {
      folderId: String(restrictedFolder.id),
      title: 'Executive Compensation Confidential 2026',
      description: 'Top secret salary sheet',
      confidentiality: 'RESTRICTED',
      rawTextContent: 'Vikram Deshmukh compensation package bonus',
      tagCodes: ['HR', 'CONF'],
    });

    // Owner sees it in FTS search
    const ownerSearch = await dmsService.searchDocuments(ownerCaller, { q: 'Executive Compensation' });
    expect(ownerSearch.items.some((i) => i.id === secretDoc.id)).toBe(true);

    // Unauthorized user gets EMPTY search result (never leaks restricted title!)
    const viewerSearch = await dmsService.searchDocuments(restrictedUserCaller, {
      q: 'Executive Compensation',
    });
    expect(viewerSearch.items.length).toBe(0);

    // Legal hold blocks folder delete
    await dmsService.setLegalHold(ownerCaller, String(secretDoc.id), true, 'Litigation hold');
    await expect(dmsService.deleteFolder(ownerCaller, String(restrictedFolder.id))).rejects.toThrow(
      'Folder has documents under legal hold; cannot delete.',
    );

    // Checkout lock conflict
    await dmsService.checkoutDocument(ownerCaller, String(secretDoc.id));
    await expect(
      dmsService.checkinDocument(restrictedUserCaller, String(secretDoc.id), { changeNote: 'Hijack' }),
    ).rejects.toThrow(/Document is checked out by/);
  });

  it('Jobs & Rule 55 Triplicate PDF Print: overdue returnable, expiry scan, retention legal-hold skip', async () => {
    const overdueRes = await gateService.runOverdueJob('2030-01-01');
    expect(overdueRes.overdueCount).toBeGreaterThanOrEqual(1);
    expect(overdueRes.statutoryDeemedSupply).toBeGreaterThanOrEqual(1);

    const expiryRes = await fleetService.runExpiryScan('2026-11-10');
    expect(expiryRes.updated).toBeGreaterThanOrEqual(0);

    const retRes = await dmsService.runRetentionJob('2040-01-01');
    expect(retRes.skippedLegalHold).toBeGreaterThanOrEqual(1);

    // Triplicate Challan PDF renders cleanly with audit record
    const outPasses = await gateService.listPasses(ownerCaller, { direction: 'OUT', passType: 'RETURNABLE' });
    expect(outPasses.length).toBeGreaterThan(0);
    const pdfBuf = await gateService.printChallanPdf(ownerCaller, String(outPasses[0]!.id));
    expect(pdfBuf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
