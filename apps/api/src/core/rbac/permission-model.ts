// The Phase 02 permission vocabulary (PHASE-02 §5): the 12 actions, the 4 data scopes, the
// resource string format, and role default configurations per §5.4.
import type { DataScope } from '@prisma/client';

export const ACTIONS = [
  'view',
  'add',
  'edit',
  'delete',
  'approve',
  'export',
  'controls',
  'submit',
  'post',
  'cancel',
  'print',
  'import',
] as const;

export type Action = (typeof ACTIONS)[number];

export const SCOPES = ['OWN', 'DEPARTMENT', 'UNIT', 'ALL'] as const;
export type Scope = (typeof SCOPES)[number];

export type ActionFlags = Record<Action, boolean>;

/** Actions that a module control's allow_* switch can veto (for Super User too). */
export const ALLOW_FLAG_FOR: Partial<
  Record<Action, 'allowAdd' | 'allowEdit' | 'allowDelete' | 'allowExport'>
> = {
  add: 'allowAdd',
  import: 'allowAdd',
  edit: 'allowEdit',
  delete: 'allowDelete',
  export: 'allowExport',
  print: 'allowExport',
};

export const DEFAULT_RESOURCE = '*';
export const familyResource = (family: string): string => `family:${family}`;
export const pageResource = (pageId: string): string => `page:${pageId}`;

export function noActions(): ActionFlags {
  return {
    view: false,
    add: false,
    edit: false,
    delete: false,
    approve: false,
    export: false,
    controls: false,
    submit: false,
    post: false,
    cancel: false,
    print: false,
    import: false,
  };
}

export function allActions(): ActionFlags {
  return {
    view: true,
    add: true,
    edit: true,
    delete: true,
    approve: true,
    export: true,
    controls: true,
    submit: true,
    post: true,
    cancel: true,
    print: true,
    import: true,
  };
}

/** §5.4 role defaults (the `*` rows). */
export const DEFAULT_ROLE_ROWS: Record<string, ActionFlags & { scope: Scope }> = {
  ADMINISTRATOR: {
    ...allActions(),
    approve: false,
    post: false,
    cancel: false,
    scope: 'ALL',
  },
  DIRECTOR: {
    ...allActions(),
    controls: false,
    scope: 'ALL',
  },
  CFO: {
    ...noActions(),
    scope: 'OWN',
  },
  GENERAL_MANAGER: {
    ...allActions(),
    delete: false,
    controls: false,
    scope: 'ALL',
  },
  DEPT_HEAD: {
    ...allActions(),
    controls: false,
    scope: 'DEPARTMENT',
  },
  DEPT_MANAGER: {
    ...allActions(),
    controls: false,
    import: false,
    scope: 'DEPARTMENT',
  },
  SUPERVISOR: {
    ...noActions(),
    view: true,
    add: true,
    edit: true,
    submit: true,
    export: true,
    print: true,
    scope: 'DEPARTMENT',
  },
  EMPLOYEE: {
    ...noActions(),
    view: true,
    add: true,
    edit: true,
    submit: true,
    print: true,
    scope: 'OWN',
  },
  // Legacy aliases
  get ADMIN() {
    return this.ADMINISTRATOR!;
  },
  get MANAGER() {
    return this.DEPT_MANAGER!;
  },
  get LEAD() {
    return this.SUPERVISOR!;
  },
  get MEMBER() {
    return this.EMPLOYEE!;
  },
};

export const CFO_ALLOWED_FAMILIES: readonly string[] = [
  'Finance & Accounts',
  'Indian Taxation',
  'Sales',
  'Procurement / SCM',
  'Business Intelligence',
  'Executive',
];
