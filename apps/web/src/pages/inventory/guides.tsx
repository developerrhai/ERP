// "How this works" strip shown under the title of every Phase 8 inventory screen: the steps in plain words and WHO does
// each one, so a new user knows what to click next. Written for store staff, not for accountants.
import { useState } from 'react';

export interface GuideStep {
  who: string;
  what: string;
}
export interface GuideDef {
  goal: string;
  steps: GuideStep[];
  tip?: string;
}

const STORE = 'Store keeper';
const MGR = 'Manager (approver)';
const QC = 'Quality person';
const ADMIN = 'Administrator';

export const GUIDES: Record<string, GuideDef> = {
  'Opening Stock': {
    goal: 'Enter the stock you already have on the day you start using the system. Do this once per item and warehouse.',
    steps: [
      {
        who: STORE,
        what: 'Click "New Opening Stock", pick the warehouse, add each item with quantity and rate, then Save draft.',
      },
      {
        who: STORE,
        what: 'Click Submit on the draft. If approval is switched on, it goes to the manager.',
      },
      {
        who: MGR,
        what: 'Open My Approvals and approve (a person cannot approve their own voucher).',
      },
      { who: STORE, what: 'Click Post. Stock and the books are updated together.' },
    ],
    tip: 'Made a mistake after posting? Use Cancel (with a reason); never try to edit a posted voucher.',
  },
  'Inventory Transactions': {
    goal: 'Receive material into a store (Receipt) or take it out (Issue). Ledger tab = every movement; Vouchers tab = the documents; Customer Material tab = material that belongs to a customer.',
    steps: [
      {
        who: STORE,
        what: 'Vouchers tab: click "New Receipt / Issue", choose Receipt or Issue, warehouse, items and quantities. Batch items need a batch number.',
      },
      { who: STORE, what: 'Save draft, then Submit.' },
      { who: MGR, what: 'Approve in My Approvals (skipped if approval is off for this page).' },
      {
        who: STORE,
        what: 'Click Post. A receipt of "Quality Inspection" items waits for the quality person before it can be issued.',
      },
    ],
    tip: 'Customer’s own material is NOT entered here; use the Customer Material tab so it never mixes with your stock.',
  },
  'Stock Adjustment': {
    goal: 'Correct the system to what is really on the shelf (damage, loss, found stock).',
    steps: [
      {
        who: STORE,
        what: 'Click "New Adjustment", pick the warehouse, enter the counted quantity of each item and the reason.',
      },
      { who: STORE, what: 'Save draft, then Submit.' },
      { who: MGR, what: 'Approve it after checking the reason.' },
      { who: STORE, what: 'Click Post.' },
    ],
  },
  'Stock Transfer': {
    goal: 'Move stock to another warehouse or unit. It goes through "in transit" so nothing is lost on the way.',
    steps: [
      {
        who: STORE,
        what: 'Sender: click "New Transfer", choose From and To warehouse and items. Save draft, Submit.',
      },
      { who: MGR, what: 'Approve.' },
      { who: STORE, what: 'Sender: click Dispatch when the goods leave.' },
      {
        who: STORE,
        what: 'Receiver: click Receive when the goods arrive, and enter the quantity that really arrived.',
      },
    ],
    tip: 'Between two units with different GSTIN a tax invoice is needed; this becomes available after the Taxation phase.',
  },
  'Batch / Lot Tracking': {
    goal: 'See every batch with its dates and quality status. Batches are created automatically when you receive stock.',
    steps: [
      {
        who: QC,
        what: 'Open a batch that is Pending QC and click Release (or Hold / Reject) with a reason.',
      },
      {
        who: STORE,
        what: 'Use "Extend expiry" only when the supplier or quality confirms a new date.',
      },
      {
        who: QC,
        what: 'Use Recall if a supplier recalls a batch; it shows every document that used it.',
      },
    ],
  },
  'Serial Number Tracking': {
    goal: 'Follow single pieces (serial numbers). Open a serial to see where it has been.',
    steps: [{ who: STORE, what: 'Search the serial number and click it to see its full history.' }],
  },
  'Bin Management': {
    goal: 'Make the shelves/bins of a warehouse so stock can be found.',
    steps: [
      {
        who: ADMIN,
        what: 'Click "New Bin", pick the warehouse and give a short code such as A-01-03.',
      },
      {
        who: STORE,
        what: 'Choose the bin when you receive stock. A bin with stock cannot be deactivated.',
      },
    ],
  },
  'Stock Reservation': {
    goal: 'Keep stock aside for a job or order so nobody else uses it.',
    steps: [
      { who: STORE, what: 'Click "New Reservation", pick item, warehouse, quantity and priority.' },
      {
        who: STORE,
        what: 'If stock is short, it waits and is filled automatically when stock arrives (Critical first).',
      },
      {
        who: STORE,
        what: 'When you issue the material, choose the reservation so it is used up. Release it if the job is cancelled.',
      },
    ],
  },
  'Stock Reconciliation': {
    goal: 'Every stock count and its differences in one place.',
    steps: [
      {
        who: STORE,
        what: 'Start a count from Cycle Count, Physical Verification or the Powder sheet.',
      },
      {
        who: MGR,
        what: 'Open a finished count, check the differences, and Approve to post them (a different person from the counter).',
      },
    ],
  },
  'Cycle Count': {
    goal: 'Count a few items at a time during the year.',
    steps: [
      { who: STORE, what: 'Click "New Count", choose the warehouse and items. Start it.' },
      { who: STORE, what: 'Enter what you physically counted (the system quantity is hidden).' },
      { who: STORE, what: 'If a difference is big, another person must recount.' },
      { who: MGR, what: 'Approve: the differences are posted as one adjustment.' },
    ],
  },
  'Physical Verification': {
    goal: 'Count a whole warehouse (year-end). The warehouse is frozen while counting.',
    steps: [
      { who: MGR, what: 'Create the count; the warehouse stops accepting stock movements.' },
      { who: STORE, what: 'Enter counted quantities for every line.' },
      { who: MGR, what: 'Approve to post differences; the warehouse unfreezes.' },
    ],
  },
  'Powder Stock Monitoring Sheet': {
    goal: 'The weekly powder check. One row per powder item, Week 1 to 5.',
    steps: [
      { who: STORE, what: 'Click "New Sheet" (once a week) and Start it.' },
      { who: STORE, what: 'Enter the counted quantity per powder item and any remark.' },
      {
        who: MGR,
        what: 'Write your name in Checked By and approve. Differences post as a stock adjustment.',
      },
    ],
  },
  'Smart Reorder': {
    goal: 'Tells you what to buy and how much, so you do not run out.',
    steps: [
      { who: ADMIN, what: 'Set a policy for an item (minimum/maximum, or lead time and usage).' },
      {
        who: STORE,
        what: 'Every morning the system lists items below their level under Suggestions.',
      },
      {
        who: MGR,
        what: 'Click Convert and write the purchase request number, or Dismiss with a reason.',
      },
    ],
  },
  'Stock Ageing': {
    goal: 'How old your stock is. Old stock ties up money.',
    steps: [{ who: MGR, what: 'Read the age buckets. Click a row to see which receipts are old.' }],
  },
  'Expiry Tracking': {
    goal: 'Which batches are expiring soon so they are used first or returned.',
    steps: [
      { who: STORE, what: 'Check the Critical and Near Expiry lines each week.' },
      { who: QC, what: 'Decide: use first, rework, return to supplier or scrap.' },
    ],
  },
  'Stock Valuation': {
    goal: 'The rupee value of stock and a check that it agrees with the books.',
    steps: [
      {
        who: MGR,
        what: 'Read the value by item and warehouse. "In balance" means stock and books agree.',
      },
      {
        who: ADMIN,
        what: '"Checks for the administrator" runs the safety checks and the one-time books cut-over.',
      },
    ],
    tip: 'Customer material is never part of this value.',
  },
  'Barcode / QR': {
    goal: 'Scan or type a barcode to see which item and batch it is. Scanning never changes stock.',
    steps: [
      {
        who: STORE,
        what: 'Click the box, scan with the handheld, or type the code, then read the result.',
      },
    ],
  },
};

export function Guide({
  title,
  def,
  defaultOpen = false,
}: {
  title: string;
  def?: GuideDef;
  defaultOpen?: boolean;
}) {
  const g = def ?? GUIDES[title];
  const [open, setOpen] = useState(defaultOpen);
  if (!g) return null;
  return (
    <section className="how-it-works" aria-label="How this works">
      <button
        type="button"
        className="how-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} How this works: who does what
      </button>
      {open ? <GuideBody g={g} /> : null}
    </section>
  );
}

export function GuideBody({ g }: { g: GuideDef }) {
  return (
    <div className="how-body">
      <p className="how-goal">{g.goal}</p>
      <ol className="how-steps">
        {g.steps.map((s, i) => (
          <li key={i}>
            <span className="how-who">{s.who}</span>
            <span>{s.what}</span>
          </li>
        ))}
      </ol>
      {g.tip ? <p className="how-tip">Good to know: {g.tip}</p> : null}
    </div>
  );
}
