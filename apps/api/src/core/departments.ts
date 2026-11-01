// The 11 departments from the prototype `DEPARTMENTS`, in order (CONTRACT §2). Since Phase 2 these are
// only the seed defaults: the departments table is the source of truth for validation and /meta.
export const DEPARTMENTS = [
  'Administration',
  'Sales',
  'Purchase',
  'Finance',
  'HR',
  'Production',
  'Quality',
  'Maintenance',
  'Warehouse',
  'Projects',
  'Service',
] as const;

export type Department = (typeof DEPARTMENTS)[number];
