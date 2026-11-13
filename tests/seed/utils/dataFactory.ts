// Why fakerEN_IN: generates culturally realistic Indian names, companies, mobile numbers,
// GST-aligned invoice narrations, PANs, and Verhoeff-valid 12-digit Aadhaar numbers.
import { fakerEN_IN as faker } from '@faker-js/faker';

export interface SeedEmployee {
  empCode: string;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: string; // YYYY-MM-DD
  dateOfJoining: string; // YYYY-MM-DD
  mobile: string; // 10-digit Indian mobile starting with 7/8/9
  personalEmail: string;
  department: string;
  designation: string;
  annualCtcInr: number;
  aadhaar: string; // 12 digits passing Indian Verhoeff checksum
  pan: string; // AAAAA9999A matching Indian Income Tax format
}

export interface SeedLead {
  name: string;
  company: string;
  mobile: string;
  email: string;
  interestedIn: string;
  expectedValueInr: string;
}

export interface SeedFinanceVoucher {
  voucherDate: string; // YYYY-MM-DD
  voucherType: 'Journal' | 'Adjustment' | 'Provision';
  invoiceNumber: string;
  counterpartyCompany: string;
  taxableAmount: string;
  gstAmount: string;
  totalAmount: string;
  dueDate: string;
  narration: string;
}

export interface SeedDemoMember {
  loginId: string;
  fullName: string;
  email: string;
  tempPassword: string;
  finalPassword: string;
}

const DEPARTMENTS = [
  'Production',
  'Purchase',
  'Sales',
  'Quality',
  'Finance',
  'Maintenance',
  'HR',
  'Logistics',
] as const;

const DESIGNATIONS = [
  'Senior Engineer',
  'Executive',
  'Team Lead',
  'Plant Supervisor',
  'Quality Analyst',
  'Accounts Officer',
] as const;

const PRODUCT_LINES = [
  'Precision CNC Turned Shafts (Batch)',
  'Industrial Hydraulic Manifold Assembly',
  'Automotive Forged Flange Kits',
  'Annual Preventive Maintenance Contract',
  'Custom Sheet Metal Enclosures',
] as const;

// Verhoeff dihedral multiplication, permutation, and inverse tables matching hr-crypto.ts
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function buildVerhoeffAadhaar(): string {
  const base11 = `${faker.helpers.arrayElement(['2', '3', '4', '5', '6', '7', '8', '9'])}${faker.string.numeric({ length: 10 })}`;
  let c = 0;
  const rev = base11.split('').map(Number).reverse();
  for (let i = 0; i < rev.length; i++) {
    c = VERHOEFF_D[c]![VERHOEFF_P[(i + 1) % 8]![rev[i]!]!]!;
  }
  const checkDigit = VERHOEFF_INV[c]!;
  return `${base11}${checkDigit}`;
}

function formatDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildIndianPan(): string {
  const letters = (len: number) => faker.string.alpha({ length: len, casing: 'upper' });
  const digits = faker.string.numeric({ length: 4 });
  return `${letters(3)}P${letters(1)}${digits}${letters(1)}`;
}

function buildUniqueMobile(used: Set<string>): string {
  let mobile = '';
  do {
    mobile = `${faker.helpers.arrayElement(['7', '8', '9'])}${faker.string.numeric({ length: 9 })}`;
  } while (used.has(mobile));
  used.add(mobile);
  return mobile;
}

export function generateRealisticDataset(count = 50): {
  runBatch: string;
  employees: SeedEmployee[];
  leads: SeedLead[];
  vouchers: SeedFinanceVoucher[];
  demoMember: SeedDemoMember;
} {
  const runBatch = String(Math.floor(Date.now() / 1000)).slice(-5);
  const usedMobiles = new Set<string>();
  const employees: SeedEmployee[] = [];
  const leads: SeedLead[] = [];
  const vouchers: SeedFinanceVoucher[] = [];

  for (let i = 1; i <= count; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const gender = faker.helpers.arrayElement(['MALE', 'FEMALE'] as const);
    const dob = faker.date.birthdate({ min: 22, max: 54, mode: 'age' });
    const doj = faker.date.between({ from: '2024-04-01', to: '2026-10-15' });
    const monthlySalary = faker.number.int({ min: 28_000, max: 1_85_000 });

    employees.push({
      empCode: `SG${runBatch}${String(i).padStart(3, '0')}`,
      firstName,
      lastName,
      gender,
      dateOfBirth: formatDateIso(dob),
      dateOfJoining: formatDateIso(doj),
      mobile: buildUniqueMobile(usedMobiles),
      personalEmail: faker.internet
        .email({ firstName, lastName, provider: 'gmail.com' })
        .toLowerCase(),
      department: faker.helpers.arrayElement(DEPARTMENTS),
      designation: faker.helpers.arrayElement(DESIGNATIONS),
      annualCtcInr: monthlySalary * 12,
      aadhaar: buildVerhoeffAadhaar(),
      pan: buildIndianPan(),
    });

    const companyName = faker.company.name();
    const contactName = faker.person.fullName();
    leads.push({
      name: contactName,
      company: companyName,
      mobile: buildUniqueMobile(usedMobiles),
      email: faker.internet
        .email({
          firstName: contactName.split(' ')[0] ?? 'contact',
          lastName: contactName.split(' ')[1] ?? String(i),
        })
        .toLowerCase(),
      interestedIn: faker.helpers.arrayElement(PRODUCT_LINES),
      expectedValueInr: String(faker.number.int({ min: 75_000, max: 24_50_000 })),
    });

    const taxable = faker.number.int({ min: 15_000, max: 4_50_000 });
    const gst = Math.round(taxable * 0.18 * 100) / 100;
    const total = (taxable + gst).toFixed(2);
    const docDate = faker.date.between({ from: '2026-04-01', to: '2026-10-30' });
    const dueDate = new Date(docDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const invNo = `INV/${runBatch}/${String(i).padStart(4, '0')}`;

    vouchers.push({
      voucherDate: formatDateIso(docDate),
      voucherType: 'Journal',
      invoiceNumber: invNo,
      counterpartyCompany: companyName,
      taxableAmount: taxable.toFixed(2),
      gstAmount: gst.toFixed(2),
      totalAmount: total,
      dueDate: formatDateIso(dueDate),
      narration: `${invNo} — ${companyName} (Taxable Rs.${taxable.toLocaleString('en-IN')} + 18% GST Rs.${gst.toFixed(2)}, Due ${formatDateIso(dueDate)})`,
    });
  }

  const demoMember: SeedDemoMember = {
    loginId: `demo.emp.${runBatch}`,
    fullName: `${employees[0]!.firstName} ${employees[0]!.lastName}`,
    email: `demo.emp.${runBatch}@sawantgroup.co.in`,
    tempPassword: `Temp@${runBatch}A1`,
    finalPassword: `Demo@${runBatch}B2`,
  };

  return { runBatch, employees, leads, vouchers, demoMember };
}

