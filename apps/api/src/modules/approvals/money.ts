// Indian money formatting for messages and emails: 75000 -> "₹75,000", 100000 -> "₹1,00,000".
// Values arrive as Decimal / string / number; only the display is formatted here, never the maths.
export function formatInr(
  value: { toString(): string } | number | string | null | undefined,
): string {
  if (value === null || value === undefined) return '₹0';
  const raw = value.toString();
  const negative = raw.startsWith('-');
  const [whole = '0', frac = ''] = (negative ? raw.slice(1) : raw).split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  let grouped = digits;
  if (digits.length > 3) {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }
  const cents = /^0*$/.test(frac) ? '' : `.${frac.replace(/0+$/, '')}`;
  return `${negative ? '-' : ''}₹${grouped}${cents}`;
}
