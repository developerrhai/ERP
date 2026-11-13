// Phase 22 (pay-loan): an interest-free staff loan is repaid in equal monthly instalments. Money is
// handled in whole paise (BigInt), never floating point; the last instalment absorbs the rounding so the
// schedule always adds up to the principal exactly. Interest-bearing loans are NOT computed here: how
// interest is charged (flat or reducing balance) is a payroll-policy decision the owner has not made.

const toPaise = (v: string): bigint => {
  const [rupees = '0', frac = ''] = v.trim().split('.');
  return BigInt(rupees) * 100n + BigInt((frac + '00').slice(0, 2));
};
const fromPaise = (p: bigint): string => `${p / 100n}.${String(p % 100n).padStart(2, '0')}`;

export interface Instalment {
  no: number;
  dueDate: string;
  amount: string;
}

/** Same day next month, clamped to the month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y = 0, m = 1, d = 1] = isoDate.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function loanSchedule(principal: string, instalments: number, firstDue: string): Instalment[] {
  if (!/^\d+(\.\d{1,2})?$/.test(principal) || toPaise(principal) <= 0n) throw new Error('Principal must be above 0.');
  if (!Number.isInteger(instalments) || instalments < 1 || instalments > 120) throw new Error('Instalments must be 1 to 120.');
  const total = toPaise(principal);
  const n = BigInt(instalments);
  const each = total / n;
  const out: Instalment[] = [];
  let paid = 0n;
  for (let i = 1; i <= instalments; i += 1) {
    const amount = i === instalments ? total - paid : each;
    paid += amount;
    out.push({ no: i, dueDate: addMonths(firstDue, i - 1), amount: fromPaise(amount) });
  }
  return out;
}

/** The regular instalment shown on the loan (the last one may differ by a few paise). */
export function regularEmi(principal: string, instalments: number): string {
  return fromPaise(toPaise(principal) / BigInt(instalments));
}
