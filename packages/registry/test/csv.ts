// Minimal RFC 4180 CSV parser for docs/REGISTRY.csv (quoted fields with commas, "" escapes).
// Exists so the registry test can cross-check menu ids without a CSV dependency.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parses CSV with a header row into objects keyed by column name. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!header) return [];
  return rows
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => {
      if (r.length !== header.length) {
        throw new Error(
          `CSV row has ${String(r.length)} fields, header has ${String(header.length)}`,
        );
      }
      return Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]));
    });
}
