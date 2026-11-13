// Phase 22-F: the fictitious company the feeders type in through the screens.
// "Demo Engineering Pvt Ltd" - every name, GSTIN and number here is made up. Never real client data.

export const COMPANY = {
  name: 'Demo Engineering Pvt Ltd',
  plants: ['Talwade', 'Sawardari', 'Varale'],
} as const;

/**
 * A run suffix keeps codes unique when the same e2e database is fed twice while iterating locally
 * (FEED_RUN=b). A normal run starts from a clean database and leaves it empty.
 */
export const SFX = process.env.FEED_RUN ?? '';
const named = (base: string): string => (SFX ? `${base} ${SFX}` : base);

export const WAREHOUSES = [
  { key: 'DEMO-WH1', code: `DEMO-WH1${SFX}`, name: named('Demo Main Store'), unit: 'Talwade' },
  { key: 'DEMO-WH2', code: `DEMO-WH2${SFX}`, name: named('Demo Powder Store'), unit: 'Talwade' },
  { key: 'DEMO-WH3', code: `DEMO-WH3${SFX}`, name: named('Demo Finished Goods'), unit: 'Sawardari' },
] as const;

/** Zones, racks and shelves for the three warehouses (Warehouse Master -> Zone -> Rack -> Shelf). */
export const LOCATIONS = [
  { warehouse: 'DEMO-WH1', zone: 'Zone A', racks: [{ code: 'R-01', shelves: ['S-01', 'S-02'] }, { code: 'R-02', shelves: ['S-01'] }] },
  { warehouse: 'DEMO-WH2', zone: 'Zone P', racks: [{ code: 'R-01', shelves: ['S-01'] }] },
  { warehouse: 'DEMO-WH3', zone: 'Zone F', racks: [{ code: 'R-01', shelves: ['S-01', 'S-02', 'S-03'] }] },
] as const;

export const CUSTOMERS = [
  { name: 'Demo Fabricators Pvt Ltd', city: 'Pune' },
  { name: 'Demo Auto Components Ltd', city: 'Nashik' },
] as const;

export const SUPPLIERS = [
  { name: 'Demo Steel Traders', city: 'Mumbai' },
  { name: 'Demo Powder Coats LLP', city: 'Thane' },
] as const;

export const ITEMS = [
  { code: 'DEMO-RM-001', name: 'Mild Steel Plate 3 mm', uom: 'Kg' },
  { code: 'DEMO-RM-002', name: 'Epoxy Powder Grey', uom: 'Kg' },
  { code: 'DEMO-FG-001', name: 'Demo Bracket Assembly', uom: 'Nos' },
] as const;

export const EMPLOYEES = [
  { firstName: 'Asha', lastName: 'Demo', department: 'Production' },
  { firstName: 'Ravi', lastName: 'Sample', department: 'Warehouse' },
] as const;

/** Two loans: Payroll -> Loans. 20,000 over 10 EMIs gives ten rows of 2,000. */
export const LOANS = [
  { employee: 'Asha Demo', principal: 20000, emis: 10 },
  { employee: 'Ravi Sample', principal: 12000, emis: 6 },
] as const;

export const INCENTIVE_SCHEME = { code: 'DEMO-INC', name: 'Demo Quarterly Incentive' } as const;

export const PROJECT = { code: 'DEMO-PRJ-1', name: 'Demo Fabrication Line', budget: 500000 } as const;

export const emiOf = (principal: number, emis: number): number => principal / emis;
