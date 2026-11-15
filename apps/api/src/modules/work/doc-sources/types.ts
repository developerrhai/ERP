// Where the records of one V40 page live, so Move Forward can list them for any page (GET /work/doc-picker/:pageId).
// Every entry is plain data: a table, the column holding the document number, and optional status / date / plant / department columns.
export interface DocSource {
  /** the V40 page id, exactly as in packages/registry/registry.v2.json */
  pageId: string;
  /** Postgres table (public schema) that holds the records the page lists */
  table: string;
  /** column shown as the document number / code / name (text or castable to text) */
  numberCol: string;
  /** status column, or omit when the table has none */
  statusCol?: string;
  /** column used to sort newest first (timestamp or date), or omit to sort by id */
  dateCol?: string;
  /** uuid plant column; the picker only lists rows in the caller's plants. Omit when the table has no plant column (then rows are not plant-filtered) */
  unitCol?: string;
  /** column holding the owning department NAME ("Sales", "Purchase", ...), or omit */
  deptCol?: string;
  /** extra fixed SQL condition, e.g. "deleted_at IS NULL". Must be a constant: no user input. */
  where?: string;
}
