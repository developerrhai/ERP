// Types a profile field from its label (docs/plan/04-modules.md §4.0.2, corrected). The first
// version reproduced the generator of the old tables, whose substring matching typed some labels
// absurdly (Priority as money, Account Name as qty, Transaction as HSN...). This version matches on
// WORDS, applies the rules in a fixed order, and lists the remaining special cases explicitly in
// classify-exceptions.ts. tests/fixtures/field-types.json is the reviewed expectation for every field.
import { PAGE_TYPE_EXCEPTIONS, TYPE_EXCEPTIONS } from './classify-exceptions';
import type { FieldType } from './field-types';

/** The first field of a page is its code when it ends in No / ID / Code / Ref / Number. */
const CODE_LABEL = /(no|id|code|ref|number)$/i;

/** Lower-case words of a label; "%" is a word of its own ("Probability %"). */
export function wordsOf(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/%/g, ' % ')
    .split(/[^a-z0-9%]+/)
    .filter(Boolean);
}

const has = (words: readonly string[], ...wanted: string[]): boolean =>
  wanted.some((w) => words.includes(w));

/** Words that make a label a name or title: always short text, never a number, date or code. */
export const NAME_WORDS = ['name', 'title'] as const;
/** Words that make a label free long text. */
export const LONGTEXT_WORDS = [
  'description',
  'subject',
  'reason',
  'remarks',
  'comments',
  'notes',
  'note',
  'address',
  'narration',
  'details',
  'problem',
  'agenda',
  'purpose',
  'query',
  'outcome',
  'specification',
  'insight',
  'condition',
  'configuration',
  'containment',
  'filters',
  'criteria',
  'terms',
  'rules',
  'action',
] as const;

const LAST_ENUM = new Set([
  'type',
  'types',
  'mode',
  'channel',
  'method',
  'category',
  'source',
  'decision',
  'result',
  'disposition',
  'class',
  'frequency',
  'scope',
  'scopes',
  'priority',
  'severity',
  'stage',
  'direction',
  'health',
  'trend',
  'confidentiality',
  'coverage',
  'criticality',
  'eligibility',
  'jurisdiction',
  'language',
  'provider',
  'format',
  'visualization',
  'regime',
]);

const QTY_WORDS = new Set([
  'qty',
  'quantity',
  'hrs',
  'hours',
  'min',
  'days',
  'count',
  'counted',
  'km',
  'weight',
  'volume',
  'odometer',
  'cbm',
  'capacity',
  'cartons',
  'attempts',
  'executions',
  'failures',
  'failed',
  'incidents',
  'turns',
  'items',
  'leads',
  'lots',
  'retries',
  'openings',
  'orders',
  'ppm',
  'participants',
  'sequence',
  'precision',
  'decimals',
  'rank',
  'sent',
  'stops',
  'lines',
  'visits',
  'jobs',
  'conversations',
  'delivered',
  'duration',
  'qualified',
  'won',
  'levels',
  'transit',
  'transactions',
  'requests',
  'errors',
  'scans',
  'timeout',
  'downtime',
  'usage',
  'length',
  'trips',
  'months',
]);

const MONEY_WORDS = new Set([
  'amount',
  'value',
  'cost',
  'price',
  'total',
  'freight',
  'budget',
  'balance',
  'outstanding',
  'paid',
  'salary',
  'revenue',
  'limit',
  'credit',
  'debit',
  'cash',
  'loan',
  'net',
  'gross',
  'profit',
  'tax',
  'taxable',
  'itc',
  'ctc',
  'emi',
  'esic',
  'pf',
  'pt',
  'hra',
  'bonus',
  'basic',
  'actual',
  'allowance',
  'allowances',
  'billed',
  'committed',
  'contribution',
  'contributions',
  'conveyance',
  'deduction',
  'deductions',
  'difference',
  'ebitda',
  'estimate',
  'forecast',
  'gratuity',
  'interest',
  'movement',
  'charges',
  'earnings',
  'payables',
  'principal',
  'ytd',
  'spend',
  'receivables',
  'refunds',
  'savings',
  'tds',
  'toll',
  'vpf',
  'variance',
  'depreciable',
  'settlement',
  'surcharge',
  'discount',
  'rate',
  'overtime',
  'income',
  'gst',
  'cgst',
  'sgst',
  'igst',
  'subtotal',
  'wage',
  'epf',
  'eps',
  'pay',
]);

const BOOL_PATTERN =
  /tracked|allowed|(^| )required$|enabled|billable$|mfa|^verified$|critical$|acknowledged|^(approve|delete|download|edit|exported|favorite|mandatory|share|upload|view|published)$|auto merge|block save|dispatch ready|parts ready|qc release|billing release|night shift|saved search|warn user|year end closed|base currency|asset return|customer signoff|^email created$|^credit check$/;

const REF_WORDS = new Set([
  'customer',
  'customers',
  'vendor',
  'supplier',
  'item',
  'warehouse',
  'employee',
  'owner',
  'manager',
  'department',
  'branch',
  'company',
  'project',
  'machine',
  'asset',
  'transporter',
  'vehicle',
  'driver',
  'approver',
  'bank',
  'bin',
  'buyer',
  'collectee',
  'collector',
  'contact',
  'custodian',
  'deductee',
  'folder',
  'grade',
  'inspector',
  'operator',
  'organizer',
  'packer',
  'parent',
  'party',
  'picker',
  'rack',
  'receiver',
  'related',
  'report',
  'requester',
  'reviewer',
  'routing',
  'salesperson',
  'scheme',
  'ticket',
  'shelf',
  'shift',
  'shipment',
  'task',
  'technician',
  'user',
  'zone',
  'hr',
  'team',
  'structure',
  'template',
  'grn',
  'account',
  'center',
  'by',
  'ref',
  'reference',
]);

/** Type of a field by its label alone (the first-field code rule is applied by classifyFields). */
export function classifyLabel(label: string): FieldType {
  const exception = TYPE_EXCEPTIONS[label];
  if (exception) return exception;
  const text = label.toLowerCase().trim();
  const w = wordsOf(label);
  const last = w.at(-1) ?? '';

  // The record's own workflow status. Every other "... Status" is an ordinary enum.
  if (text === 'status') return 'status';

  // Identifiers: only labels that clearly are those identifiers.
  if (has(w, 'gstin')) return 'gstin';
  if (has(w, 'aadhaar')) return 'aadhaar';
  if (text === 'pan') return 'pan';
  if (has(w, 'ifsc')) return 'ifsc';
  if (has(w, 'uan')) return 'uan';
  if (/^hsn( sac)?$/.test(text)) return 'hsn';
  if (has(w, 'mobile') || /^(phone|contact phone|phone no|phone number)$/.test(text))
    return 'phone';
  if (/^(email|e-mail|email id|from address|to address)$/.test(text)) return 'email';

  // Names and titles are short text; descriptions and the like are long text.
  if (has(w, ...NAME_WORDS)) return 'text';
  if (has(w, ...LONGTEXT_WORDS) && !/^(credit|debit) notes$/.test(text)) return 'longtext';

  if (last === 'status') return 'enum';
  if (w.includes('%')) return 'pct';
  if (last === 'date') return 'date';
  if (last === 'at') return 'datetime';
  if (
    /\b(start|end|from|until|till)$|valid (to|from)|effective to|posting to/.test(text) &&
    !/^(warehouse|ship|source)/.test(text)
  ) {
    return 'date';
  }
  const durationTime = last === 'time' && !has(w, 'min', 'hrs', 'hours');
  if (!durationTime && w.some((x) => QTY_WORDS.has(x))) return 'qty';
  if (
    durationTime ||
    /arrival|departure|punch|last (update|updated|sync|run|used|login|read)|next run/.test(text)
  ) {
    return 'datetime';
  }
  if (['month', 'period'].includes(last)) return 'date';
  if (
    /expiry|\bdue\b|\bvalid\b|\beffective\b|follow up|last (audit|calibration|done|movement|printed|scan|service)|next (service|due)|planned (start|end)/.test(
      text,
    )
  ) {
    return 'date';
  }
  if (has(w, 'score', 'probability', 'rating', 'efficiency', 'accuracy')) return 'pct';
  if (LAST_ENUM.has(last)) return 'enum';
  if (BOOL_PATTERN.test(text)) return 'bool';
  if (/cost center|profit center|budget head/.test(text)) return 'ref';
  if (w.some((x) => MONEY_WORDS.has(x))) return 'money';
  if (w.some((x) => REF_WORDS.has(x))) return 'ref';
  return 'text';
}

/**
 * Dates that plan, forecast or record an outcome (known only later): never required just for being
 * the first date.
 */
const PLANNING_DATE =
  /^(next|expected|last|due|planned|target|expiry|expire|valid|reserved|available|baseline|probation|warranty|review|renewal|closure|close|closing|return|end|posting|actual|effectiveness|service|promise|completion|completed|resolved|resolution|delivered|delivery|received|paid|dispatched|closed|finish|finished|verified|approved|signed|reported)( |$)|follow-up/i;

const PARTY_REF = /customer|vendor|supplier|item|employee|machine|asset|project/i;

export interface ClassifiedField {
  label: string;
  type: FieldType;
  required: boolean;
}

/**
 * Types and required marks for a page's field labels, in order. Required: the first field, any
 * ...Name field, the first party reference and the first date.
 */
export function classifyFields(pageId: string, labels: readonly string[]): ClassifiedField[] {
  const fields = labels.map((label, index): ClassifiedField => {
    const isCode = index === 0 && CODE_LABEL.test(label.trim());
    return {
      label,
      type: isCode ? 'code' : (PAGE_TYPE_EXCEPTIONS[`${pageId}::${label}`] ?? classifyLabel(label)),
      required: index === 0 || label.toLowerCase().endsWith('name'),
    };
  });
  const party = fields.find((f) => f.type === 'ref' && PARTY_REF.test(f.label));
  if (party) party.required = true;
  // Only a document date (Order Date, Invoice Date, Date...) is required, not a planning date.
  const firstDate = fields.find((f) => f.type === 'date' && !PLANNING_DATE.test(f.label.trim()));
  if (firstDate) firstDate.required = true;
  return fields;
}

/** A master page's first field is a Code/ID-style label without "No" (docs/phase3-4 B3). */
export function isMasterPage(firstLabel: string | undefined): boolean {
  return firstLabel !== undefined && /(code|id|ref|number)$/i.test(firstLabel.trim());
}
