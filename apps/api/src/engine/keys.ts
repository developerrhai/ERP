// Turns a profile field label into the camelCase key used in a record's `data` object
// ("Next Follow-up" -> nextFollowUp, "Probability %" -> probabilityPct). Keys are unique per page.
export function labelToKey(label: string): string {
  const words = label
    .replace(/%/g, ' Pct ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const camel = words
    .map((w, i) => {
      const lower = w.toLowerCase();
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
  return /^[a-z]/.test(camel) ? camel : `f${camel}`;
}

/** Keys for a list of labels; a repeated key gets a numeric suffix (name, name2, ...). */
export function uniqueKeys(labels: readonly string[]): string[] {
  const used = new Set<string>();
  return labels.map((label) => {
    const base = labelToKey(label);
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}${n}`;
    used.add(key);
    return key;
  });
}
