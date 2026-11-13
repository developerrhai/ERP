// Phase 30 pure rules: wage line (the spec example to the rupee), Maharashtra PT, compliance score, budget level,
// deployment checks, bill reconciliation, TDS rate. Statutory numbers are parameters (R-11); the defaults are the starting rows.

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface WageRules { pfRate: number; pfCeiling: number; esicRate: number; esicCeiling: number; otMultiplier: number }
export const DEFAULT_WAGE_RULES: WageRules = { pfRate: 12, pfCeiling: 15000, esicRate: 0.75, esicCeiling: 21000, otMultiplier: 2 };

/** Maharashtra professional tax: men 7,501-10,000 = 175 and above 10,000 = 200 (February 300); women up to 25,000 nil. */
export function professionalTax(gross: number, gender: 'M' | 'F' | 'O' | null, month: number): number {
  if (gender === 'F') return gross > 25000 ? (month === 2 ? 300 : 200) : 0;
  if (gross <= 7500) return 0;
  if (gross <= 10000) return 175;
  return month === 2 ? 300 : 200;
}

export interface WageInput { days: number; dailyRate: number; otHours: number; gender: 'M' | 'F' | 'O' | null; month: number; allowance?: number; rules?: WageRules }
export interface WageLine { basic: number; otRate: number; otAmount: number; gross: number; pf: number; esic: number; pt: number; totalDeduction: number; net: number }

/** 26 days x 600 = 15,600; OT 10 h x (600 / 8 x 2 = 150) = 1,500; gross 17,100; PF 1,800; ESIC 128.25 rounded up = 129; PT 200; net 14,971. */
export function wageLine(i: WageInput): WageLine {
  const rules = i.rules ?? DEFAULT_WAGE_RULES;
  const basic = r2(i.days * i.dailyRate);
  const otRate = r2((i.dailyRate / 8) * rules.otMultiplier);
  const otAmount = r2(i.otHours * otRate);
  const gross = r2(basic + otAmount + (i.allowance ?? 0));
  const pf = r2((Math.min(basic, rules.pfCeiling) * rules.pfRate) / 100);
  const esic = gross <= rules.esicCeiling ? Math.ceil((gross * rules.esicRate) / 100 - 1e-9) : 0;
  const pt = professionalTax(gross, i.gender, i.month);
  const totalDeduction = r2(pf + esic + pt);
  return { basic, otRate, otAmount, gross, pf, esic, pt, totalDeduction, net: r2(gross - totalDeduction) };
}

/** Passed checks / required checks x 100 (10 of 11 = 90.91). */
export function complianceScore(passed: number, required: number): number {
  return required <= 0 ? 0 : r2((passed / required) * 100);
}
export const riskOf = (score: number): 'Low' | 'Medium' | 'High' => (score >= 100 ? 'Low' : score >= 80 ? 'Medium' : 'High');

export type BudgetLevel = 'OK' | 'AMBER' | 'BLOCKED';
/** Amber from 90 %, blocked at 100 %. */
export function budgetLevel(utilized: number, budget: number): { pct: number; level: BudgetLevel } {
  if (budget <= 0) return { pct: 0, level: 'OK' };
  const pct = r2((utilized / budget) * 100);
  return { pct, level: pct >= 100 ? 'BLOCKED' : pct >= 90 ? 'AMBER' : 'OK' };
}

export const dmy = (d: string | Date): string => {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
};

export interface DeployFacts {
  date: string;
  contractor: { licenceValidUntil: string | null; agreementEnd: string | null; insuranceExpiry: string | null; status: string; approval: string };
  workOrder: { status: string; headcount: number; deployed: number; budgetPct: number; start: string; end: string };
  checks: Record<string, { validUntil: string | null } | undefined>;
  policeRequired: boolean;
}

/** The first thing that stops a deployment (null = allowed). Messages as in the spec. */
export function deployBlock(f: DeployFacts): string | null {
  const d = f.date.slice(0, 10);
  const expired = (v: string | null): boolean => v !== null && v.slice(0, 10) < d;
  if (f.contractor.approval !== 'Approved') return "Can't deploy: the contractor is not approved yet.";
  if (f.contractor.status !== 'Active') return `Can't deploy: the contractor is ${f.contractor.status.toLowerCase()}.`;
  if (!f.contractor.licenceValidUntil || expired(f.contractor.licenceValidUntil)) return `Can't deploy: contractor licence ${f.contractor.licenceValidUntil ? `expired on ${dmy(f.contractor.licenceValidUntil)}` : 'is missing'}.`;
  if (!f.contractor.agreementEnd || expired(f.contractor.agreementEnd)) return `Can't deploy: contractor agreement ${f.contractor.agreementEnd ? `ended on ${dmy(f.contractor.agreementEnd)}` : 'is missing'}.`;
  if (!f.contractor.insuranceExpiry || expired(f.contractor.insuranceExpiry)) return `Can't deploy: contractor insurance ${f.contractor.insuranceExpiry ? `expired on ${dmy(f.contractor.insuranceExpiry)}` : 'is missing'}.`;
  if (f.workOrder.status !== 'Active') return `Can't deploy: the work order is ${f.workOrder.status.toLowerCase()}.`;
  if (d < f.workOrder.start.slice(0, 10) || d > f.workOrder.end.slice(0, 10)) return `Can't deploy: ${dmy(d)} is outside the work order dates.`;
  if (f.workOrder.deployed >= f.workOrder.headcount) return `Work order headcount full (${f.workOrder.deployed}/${f.workOrder.headcount}).`;
  if (f.workOrder.budgetPct >= 100) return 'Can\'t deploy: the work order budget is fully used.';
  const kyc = f.checks.KYC;
  if (!kyc) return "Can't deploy: KYC is not verified.";
  const med = f.checks.MEDICAL;
  if (!med) return "Can't deploy: medical fitness is not done.";
  if (expired(med.validUntil)) return `Can't deploy: medical fitness expired on ${dmy(med.validUntil as string)}.`;
  const ind = f.checks.INDUCTION;
  if (!ind) return "Can't deploy: safety induction is not done.";
  if (expired(ind.validUntil)) return `Can't deploy: safety induction expired on ${dmy(ind.validUntil as string)}.`;
  if (f.policeRequired) {
    const pol = f.checks.POLICE;
    if (!pol) return "Can't deploy: police verification is not done.";
    if (expired(pol.validUntil)) return `Can't deploy: police verification expired on ${dmy(pol.validUntil as string)}.`;
  }
  if (!f.checks.PPE) return "Can't deploy: PPE is not issued.";
  return null;
}

/** Billed man-days against the muster: the difference in days x the rate is disputed. */
export function reconcileDays(billed: number, muster: number, rate: number): { diffDays: number; disputed: number } {
  const diffDays = Math.max(0, r2(billed - muster));
  return { diffDays, disputed: r2(diffDays * rate) };
}

/** 194C: 1 % when the PAN is an individual or HUF (4th letter P / H), 2 % otherwise. */
export function tdsPctFor(pan: string | null): number {
  const c = (pan ?? '').charAt(3).toUpperCase();
  return c === 'P' || c === 'H' ? 1 : 2;
}

export function invoiceMoney(i: { manDays: number; rate: number; otValue: number; serviceChargePct: number; gstPct: number; tdsPct: number }): { basic: number; serviceCharge: number; taxable: number; gst: number; gross: number; tds: number; net: number } {
  const basic = r2(i.manDays * i.rate);
  const serviceCharge = r2(((basic + i.otValue) * i.serviceChargePct) / 100);
  const taxable = r2(basic + i.otValue + serviceCharge);
  const gst = r2((taxable * i.gstPct) / 100);
  const gross = r2(taxable + gst);
  const tds = r2((taxable * i.tdsPct) / 100);
  return { basic, serviceCharge, taxable, gst, gross, tds, net: r2(gross - tds) };
}

export const COMPLIANCE_CHECKS = ['LICENCE', 'AGREEMENT', 'INSURANCE', 'PF_ECR', 'PF_CHALLAN', 'ESIC_CHALLAN', 'MUSTER_ROLL', 'WAGE_REGISTER', 'BANK_PROOF', 'BONUS_REGISTER', 'RETURN_FILED'] as const;
export const CHECK_LABEL: Record<string, string> = {
  LICENCE: 'contractor licence', AGREEMENT: 'agreement', INSURANCE: 'insurance', PF_ECR: 'PF ECR', PF_CHALLAN: 'PF challan', ESIC_CHALLAN: 'ESIC challan',
  MUSTER_ROLL: 'muster roll', WAGE_REGISTER: 'wage register', BANK_PROOF: 'wage bank proof', BONUS_REGISTER: 'bonus register', RETURN_FILED: 'return filed',
};
