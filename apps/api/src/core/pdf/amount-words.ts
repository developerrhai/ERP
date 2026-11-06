// Indian money formatting (lakh / crore grouping) and "Rupees ... Only" in words.

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
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds] ?? ''} Hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest] ?? '');
    else
      parts.push(
        `${TENS[Math.floor(rest / 10)] ?? ''}${rest % 10 ? ` ${ONES[rest % 10] ?? ''}` : ''}`,
      );
  }
  return parts.join(' ');
}

function integerInWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore > 0) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${below1000(thousand)} Thousand`);
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 123456.5 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only". */
export function rupeesInWords(amount: number): string {
  const negative = amount < 0;
  const paiseTotal = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  let words = `Rupees ${integerInWords(rupees)}`;
  if (paise > 0) words += ` and ${integerInWords(paise)} Paise`;
  return `${negative ? 'Minus ' : ''}${words} Only`;
}

/** 123456.5 -> "1,23,456.50" (Indian grouping). */
export function groupIndian(value: number, decimals = 2): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart = '0', frac] = fixed.split('.');
  const last3 = intPart.slice(-3);
  const other = intPart.slice(0, -3);
  const grouped = other === '' ? last3 : `${other.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  return `${value < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatInr(value: number): string {
  return `₹ ${groupIndian(value, 2)}`;
}
