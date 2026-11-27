// The Quality pages of the v2 specification whose register is the shared V40 register (no imports here: the register,
// the tab frame and the module page all read this).
const NOUNS: Record<string, string> = {
  'qms-customer-ncr': 'Customer NCRs',
  'qms-conformance-ncr': 'Conformance NCRs',
  'qms-templates': 'Formats',
  'qms-rejection-revoke': 'Rejections',
};

export const QMS_V2_REGISTER_IDS: ReadonlySet<string> = new Set(Object.keys(NOUNS));

/** Every record prints, e-mails and moves to the next department. */
export const QMS_V2_PAGE_CFG: Record<string, { noun: string; print: boolean; move: boolean }> = Object.fromEntries(
  Object.entries(NOUNS).map(([id, noun]) => [id, { noun, print: true, move: true }]),
);
