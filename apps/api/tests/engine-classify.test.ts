// The field-type classifier (docs/phase3-4 B1). tests/fixtures/field-types.json is the REVIEWED
// expectation for all 2,773 fields of the 244 pages with a profile (label, type, required): it started
// from the old docs/plan/04-modules.md tables and was corrected where those typed a label absurdly.
// tests/fixtures/type-changes.json lists every label whose type differs from the old tables.
// Also: labels that must be text, identifier detection, the label->key and validator helpers.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyFields, classifyLabel, isMasterPage, wordsOf } from '../src/engine/classify';
import { labelToKey, uniqueKeys } from '../src/engine/keys';
import { gstinCheckChar, isGstin, isIsoDate, maskAadhaar } from '../src/engine/validators';
import { profileOf } from '../src/core/registry';

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'field-types.json'), 'utf8'),
) as Record<string, [string, string, boolean][]>;

describe('classifier vs the reviewed field types', () => {
  it('the fixture covers every page of the registry that has a profile', () => {
    expect(Object.keys(fixture)).toHaveLength(244);
    let fields = 0;
    for (const [pageId, rows] of Object.entries(fixture)) {
      const profile = profileOf(pageId);
      expect(profile?.fields, pageId).toEqual(rows.map((r) => r[0]));
      fields += rows.length;
    }
    expect(fields).toBe(2773);
  });

  it('gives every field of every page its reviewed type', () => {
    const wrong: string[] = [];
    for (const [pageId, rows] of Object.entries(fixture)) {
      const got = classifyFields(
        pageId,
        rows.map((r) => r[0]),
      );
      rows.forEach(([label, type], i) => {
        if (got[i]?.type !== type) wrong.push(`${pageId}/${label}: ${type} != ${got[i]?.type}`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it('gives every field of every page its reviewed required mark', () => {
    const wrong: string[] = [];
    for (const [pageId, rows] of Object.entries(fixture)) {
      const got = classifyFields(
        pageId,
        rows.map((r) => r[0]),
      );
      rows.forEach(([label, , required], i) => {
        if (got[i]?.required !== required) wrong.push(`${pageId}/${label}: required ${required}`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it('type totals (snapshot counts per type)', () => {
    const counts: Record<string, number> = {};
    for (const [pageId, rows] of Object.entries(fixture)) {
      for (const f of classifyFields(
        pageId,
        rows.map((r) => r[0]),
      )) {
        counts[f.type] = (counts[f.type] ?? 0) + 1;
      }
    }
    expect(counts).toEqual({
      aadhaar: 1,
      bool: 47,
      code: 207,
      date: 253,
      datetime: 63,
      email: 5,
      enum: 211,
      gstin: 13,
      hsn: 2,
      longtext: 93,
      money: 348,
      pan: 7,
      pct: 94,
      phone: 6,
      qty: 324,
      ref: 500,
      status: 239,
      text: 357,
      uan: 3,
    });
  });

  it('spot checks of the rules in section 4.0.2', () => {
    expect(classifyLabel('Mobile')).toBe('phone');
    expect(classifyLabel('GSTIN')).toBe('gstin');
    expect(classifyLabel('Aadhaar')).toBe('aadhaar');
    expect(classifyLabel('Next Follow-up')).toBe('date');
    expect(classifyLabel('Probability %')).toBe('pct');
    expect(classifyLabel('Expected Value')).toBe('money');
    expect(classifyLabel('Qualification Score')).toBe('pct');
    expect(classifyLabel('Warehouse')).toBe('ref');
    expect(classifyLabel('IFSC Code')).toBe('ifsc');
    expect(classifyLabel('Remarks')).toBe('longtext');
    expect(classifyLabel('Something Unknown')).toBe('text');
    // The first field is a code only when it ends in No / ID / Code / Ref / Number.
    expect(classifyFields('x', ['Lead No', 'Name'])[0]?.type).toBe('code');
    expect(classifyFields('x', ['Customer', 'Name'])[0]?.type).toBe('ref');
    expect(classifyFields('x', ['Lead No', 'Lead Name', 'Status']).map((f) => f.required)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('formerly absurd typings are sane now', () => {
    const expected: [string, string][] = [
      ['Priority', 'enum'],
      ['FEFO Priority', 'enum'],
      ['Severity', 'enum'],
      ['Account Name', 'text'],
      ['Account Type', 'enum'],
      ['Business Account', 'ref'],
      ['Transaction', 'text'],
      ['Transactions Today', 'qty'],
      ['Transaction Type', 'enum'],
      ['HSN SAC Scope', 'enum'],
      ['Phone Number ID', 'text'],
      ['Monthly Cost', 'money'],
      ['Validation', 'text'],
      ['Validation Errors', 'qty'],
      ['Updated By', 'ref'],
      ['Employee Candidate', 'text'],
      ['Rate', 'money'],
      ['GST Rate', 'pct'],
      ['Gross Weight', 'qty'],
      ['Balance Qty', 'qty'],
      ['Consent Status', 'enum'],
      ['Approval Status', 'enum'],
      ['QC Status', 'enum'],
      ['Payment Status', 'enum'],
      ['Hold Status', 'enum'],
      ['Posting Status', 'enum'],
      ['Status', 'status'],
      ['Stage', 'enum'],
      ['Type', 'enum'],
      ['Mode', 'enum'],
      ['Channel', 'enum'],
      ['Category', 'enum'],
      ['Method', 'enum'],
    ];
    for (const [label, type] of expected) expect(classifyLabel(label), label).toBe(type);
    // "Current" means an ageing bucket (amount) on one page and a yes/no flag on another.
    expect(classifyFields('fin-ageing', ['Party Code', 'Current'])[1]?.type).toBe('money');
    expect(classifyFields('admin-fy', ['FY Code', 'Current'])[1]?.type).toBe('bool');
  });

  it('only labels that clearly are identifiers get identifier types', () => {
    const identifier = new Set(['gstin', 'pan', 'ifsc', 'hsn', 'aadhaar', 'uan', 'phone', 'email']);
    const wrong: string[] = [];
    for (const [pageId, rows] of Object.entries(fixture)) {
      for (const [label, type] of rows) {
        if (!identifier.has(type)) continue;
        const ok: Record<string, RegExp> = {
          gstin: /gstin/i,
          pan: /^pan$/i,
          ifsc: /ifsc/i,
          hsn: /^hsn( sac)?$/i,
          aadhaar: /aadhaar/i,
          uan: /uan/i,
          phone: /mobile|^phone/i,
          email: /^(email|from address)$/i,
        };
        if (!ok[type]?.test(label)) wrong.push(`${pageId}/${label}: ${type}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(classifyLabel('Transaction')).not.toBe('hsn');
    expect(classifyLabel('Transactions Today')).not.toBe('hsn');
  });

  it('a label with Name / Title / Description / Subject / Reason / Remarks / Comments / Notes / Address is always text or long text', () => {
    const words = [
      'name',
      'title',
      'description',
      'subject',
      'reason',
      'remarks',
      'comments',
      'notes',
      'note',
      'address',
    ];
    // Not free text on purpose: first-field codes (Credit Note No), a reference to another
    // document, an amount of credit notes, and the sender e-mail address.
    const exempt = new Set(['Credit Note Ref', 'Credit Notes', 'From Address']);
    const wrong: string[] = [];
    for (const [pageId, rows] of Object.entries(fixture)) {
      rows.forEach(([label, type], index) => {
        const hit = wordsOf(label).some((w) => words.includes(w));
        if (!hit || exempt.has(label) || (index === 0 && type === 'code')) return;
        if (type !== 'text' && type !== 'longtext') wrong.push(`${pageId}/${label}: ${type}`);
      });
    }
    expect(wrong).toEqual([]);
    for (const label of [
      'Name',
      'Item Name',
      'Job Title',
      'Description',
      'Registered Address',
      'Remarks',
    ]) {
      expect(['text', 'longtext'], label).toContain(classifyLabel(label));
    }
  });

  it('only the field labelled Status is the workflow status; the other Status fields are plain enums', () => {
    for (const [pageId, rows] of Object.entries(fixture)) {
      for (const [label, type] of rows) {
        if (label === 'Status') expect(type, pageId).toBe('status');
        else if (label.endsWith('Status')) expect(type, `${pageId}/${label}`).toBe('enum');
      }
    }
  });

  it('type-changes.json lists exactly the labels that differ from the old tables', () => {
    const changes = JSON.parse(
      readFileSync(path.join(__dirname, 'fixtures', 'type-changes.json'), 'utf8'),
    ) as { label: string; from: string; to: string; pages: string[] }[];
    expect(changes.length).toBeGreaterThan(200);
    for (const c of changes) {
      expect(c.from).not.toBe(c.to);
      for (const pageId of c.pages) {
        const row = fixture[pageId]?.find((r) => r[0] === c.label);
        expect(row?.[1], `${pageId}/${c.label}`).toBe(c.to);
      }
    }
  });

  it('the first DOCUMENT date is required; planning dates stay optional', () => {
    const req = (pageId: string, labels: string[]) =>
      classifyFields(pageId, labels).map((f) => f.required);
    // Order Date is the first document date; Next Follow-up is a plan.
    expect(req('x', ['Lead No', 'Next Follow-up', 'Order Date', 'Due Date'])).toEqual([
      true,
      false,
      true,
      false,
    ]);
    for (const label of [
      'Next Follow-up',
      'Expected Close',
      'Last Audit',
      'Due Date',
      'Planned Start',
      'Target Date',
      'Expiry Date',
      'Valid Till',
      'Reserved Until',
      'Available From',
      'Baseline Start',
      'Probation End',
      'Warranty End',
      'Review Date',
      'Renewal Date',
      'Closure Date',
      'Closing Date',
      'Return Date',
      'End Date',
      'Posting From',
      'Actual Date',
      'Effectiveness Date',
      'Service Date',
      'Promise Date',
      'Completion Date',
      'Resolved Date',
      'Delivered Date',
      'Received Date',
      'Paid Date',
      'Dispatched Date',
      'Closed Date',
      'Finish Date',
      'Verified Date',
      'Approved Date',
      'Signed Date',
      'Reported Date',
    ]) {
      expect(classifyFields('x', ['Doc No', label])[1]?.required, label).toBe(false);
    }
    for (const label of ['Order Date', 'Quote Date', 'Invoice Date', 'Date', 'PR Date']) {
      expect(classifyFields('x', ['Doc No', label])[1]?.required, label).toBe(true);
    }
    // A page whose dates are all plans has no required date.
    expect(req('x', ['Doc No', 'Due Date', 'Next Service'])).toEqual([true, false, false]);
    const changes = JSON.parse(
      readFileSync(path.join(__dirname, 'fixtures', 'required-changes.json'), 'utf8'),
    ) as { page: string; label: string; from: boolean; to: boolean }[];
    expect(changes.length).toBeGreaterThan(30);
    for (const c of changes) {
      expect(c.from).not.toBe(c.to);
      expect(fixture[c.page]?.find((r) => r[0] === c.label)?.[2], `${c.page}/${c.label}`).toBe(
        c.to,
      );
    }
    // Next Follow-up on the lead form is optional.
    expect(fixture['crm-leads']?.find((r) => r[0] === 'Next Follow-up')?.[2]).toBe(false);
  });

  it('masters vs transactional pages', () => {
    expect(isMasterPage('Source Code')).toBe(true);
    expect(isMasterPage('Record ID')).toBe(true);
    expect(isMasterPage('Lead No')).toBe(false);
    expect(isMasterPage('Invoice Number')).toBe(true);
    expect(isMasterPage('Customer')).toBe(false);
    expect(isMasterPage(undefined)).toBe(false);
  });
});

describe('keys and validators', () => {
  it('builds camelCase keys, unique per page', () => {
    expect(labelToKey('Next Follow-up')).toBe('nextFollowUp');
    expect(labelToKey('Probability %')).toBe('probabilityPct');
    expect(labelToKey('0 30 Qty')).toBe('f030Qty');
    expect(labelToKey('Part B Status')).toBe('partBStatus');
    expect(uniqueKeys(['Name', 'name', 'NAME'])).toEqual(['name', 'name2', 'name3']);
  });

  it('GSTIN needs the pattern and a correct check character', () => {
    const first14 = '27AAPFU0939F1Z';
    const good = first14 + gstinCheckChar(first14);
    expect(isGstin(good)).toBe(true);
    expect(isGstin('27AAPFU0939F1ZV')).toBe(good === '27AAPFU0939F1ZV');
    const wrong = good.slice(0, 14) + (good.endsWith('A') ? 'B' : 'A');
    expect(isGstin(wrong)).toBe(false);
    expect(isGstin('NOTAGSTIN')).toBe(false);
  });

  it('dates must be real calendar dates; Aadhaar is masked to the last four digits', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-28')).toBe(false);
    expect(maskAadhaar('234567891234')).toBe('XXXXXXXX1234');
  });
});
