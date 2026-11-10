// packages/calc/src/payroll/amount-in-words.ts
// Converts numbers to words in Indian currency system (Lakh / Crore).

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function convertLessThanThousand(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)]!;
    const ones = ONES[n % 10]!;
    return ones ? `${tens} ${ones}` : tens;
  }
  const hundreds = `${ONES[Math.floor(n / 100)]} Hundred`;
  const rest = convertLessThanThousand(n % 100);
  return rest ? `${hundreds} ${rest}` : hundreds;
}

export function amountInWordsIndian(amount: number): string {
  if (amount === 0) return 'Zero';
  if (amount < 0) return `Minus ${amountInWordsIndian(Math.abs(amount))}`;

  let n = Math.floor(amount);
  const parts: string[] = [];

  // Crores: >= 10,000,000
  if (n >= 10000000) {
    const crores = Math.floor(n / 10000000);
    parts.push(`${amountInWordsIndian(crores)} Crore`);
    n %= 10000000;
  }

  // Lakhs: >= 100,000
  if (n >= 100000) {
    const lakhs = Math.floor(n / 100000);
    parts.push(`${convertLessThanThousand(lakhs)} Lakh`);
    n %= 100000;
  }

  // Thousands: >= 1,000
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    parts.push(`${convertLessThanThousand(thousands)} Thousand`);
    n %= 1000;
  }

  // Remaining < 1,000
  if (n > 0) {
    parts.push(convertLessThanThousand(n));
  }

  return parts.join(' ').trim();
}

