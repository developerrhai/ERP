export interface AmcRevenueMonth {
  periodMonth: string; // 'YYYY-MM'
  daysCount: number;
  amount: number;
}

export interface AmcRevenueScheduleResult {
  totalContractDays: number;
  contractValue: number;
  months: AmcRevenueMonth[];
}

function parseYmd(str: string): Date {
  const [y, m, d] = str.split('-').map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function daysBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1; // inclusive
}

export function computeAmcRevenueSchedule(
  startDateStr: string,
  endDateStr: string,
  contractValue: number,
): AmcRevenueScheduleResult {
  const startDate = parseYmd(startDateStr);
  const endDate = parseYmd(endDateStr);

  const totalContractDays = daysBetween(startDate, endDate);
  if (totalContractDays <= 0) {
    return { totalContractDays: 0, contractValue, months: [] };
  }

  // Iterate month by month
  const months: AmcRevenueMonth[] = [];
  let curr = new Date(startDate);
  let accumulatedRecognized = 0;

  while (curr <= endDate) {
    const year = curr.getUTCFullYear();
    const month = curr.getUTCMonth(); // 0-11
    const periodMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Month end date or contract end date, whichever is earlier
    const nextMonthFirst = new Date(Date.UTC(year, month + 1, 1));
    const lastDayOfMonth = new Date(nextMonthFirst.getTime() - 24 * 60 * 60 * 1000);
    const periodEnd = lastDayOfMonth < endDate ? lastDayOfMonth : endDate;

    const daysInPeriod = daysBetween(curr, periodEnd);
    months.push({
      periodMonth,
      daysCount: daysInPeriod,
      amount: 0, // calculated below
    });

    // Advance to next month's 1st
    curr = nextMonthFirst;
  }

  // Compute daily straight-line amounts
  const dailyRate = contractValue / totalContractDays;
  for (let i = 0; i < months.length; i++) {
    const m = months[i]!;
    if (i === months.length - 1) {
      // Last month absorbs remainder to guarantee exact contract value
      const remainder = Math.round((contractValue - accumulatedRecognized) * 100) / 100;
      m.amount = remainder;
    } else {
      const rawAmt = Math.round(m.daysCount * dailyRate * 100) / 100;
      m.amount = rawAmt;
      accumulatedRecognized += rawAmt;
    }
  }

  return {
    totalContractDays,
    contractValue,
    months,
  };
}

