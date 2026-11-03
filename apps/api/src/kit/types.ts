// Kit schema and registration contracts (docs/plans/07-ENGINE-KIT.md §2.1)
// Types for typed pages, commands, panels, filters, lookups, and print templates.

export type Requires = 'add' | 'edit' | 'delete' | 'approve';

export interface PayloadField {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'qty' | 'money' | 'pct' | 'date' | 'bool' | 'enum' | 'lookup';
  required: boolean;
  options?: string[];
  lookup?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface KitCommand {
  key: string;
  label: string;
  variant: 'primary' | 'default' | 'danger';
  requires: Requires;
  confirm: string | null;
  fields?: PayloadField[];
}

export interface TabPanelRef {
  tab: string;
  key: string;
  scope: 'record' | 'page';
  title?: string;
  component?: string;
}

export interface PrintTemplateRef {
  key: string;
  label: string;
  kind: 'web' | 'pdf';
  scope: 'record' | 'page';
  default?: boolean;
}

export type FilterType = 'bool' | 'select' | 'text' | 'date' | 'month' | 'lookup';

export interface KitFilter {
  key: string;
  label: string;
  type: FilterType;
  param: string;
  options?: string[];
  lookup?: string;
}

export interface KitSchemaExtras {
  tabPanels?: TabPanelRef[];
  commands?: KitCommand[];
  readOnlyCreate?: boolean;
  printTemplates?: PrintTemplateRef[];
}
