// Amount in words, Indian style (lakh / crore): 125000.50 -> "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only".
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
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) parts.push(ONES[n] ?? '');
  return parts.join(' ');
}

function wholeInWords(n: number): string {
  if (n === 0) return 'Zero';
  const units: [number, string][] = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
  ];
  const out: string[] = [];
  for (const [size, name] of units) {
    if (n >= size) {
      out.push(`${wholeInWords(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) out.push(below1000(n));
  return out.join(' ');
}

export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '';
  const rupees = Math.floor(amount + 1e-9);
  const paise = Math.round((amount - rupees) * 100);
  const r = `Rupees ${wholeInWords(rupees)}`;
  return paise > 0 ? `${r} and ${wholeInWords(paise)} Paise Only` : `${r} Only`;
}
