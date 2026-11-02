// The Indian financial-year rules in one place (Phase 3 §A1): a year runs 1 April – 31 March, its
// code is "YYYY-YY" and its label "FY YYYY-YY". Pure functions, shared by the service and the seed.

/** "2026-27" for 2026. */
export function fyCode(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function fyLabel(startYear: number): string {
  return `FY ${fyCode(startYear)}`;
}

/** UTC-midnight dates, as Prisma stores @db.Date values. */
export function fyDates(startYear: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(startYear, 3, 1)),
    endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
  };
}

/** Start year of a "YYYY-YY" code, or null when the code is malformed or the years do not follow. */
export function startYearOfCode(code: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(code);
  if (!match?.[1] || !match[2]) return null;
  const year = Number(match[1]);
  return fyCode(year) === code ? year : null;
}

/** "YYYY-MM-DD" -> Date (UTC midnight), or null when not a real calendar date. */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isoDate(date) === value ? date : null;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The start year of the financial year that contains `date` (UTC calendar date). */
export function fyStartYearOf(date: Date): number {
  return date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}
