// Per-page enum option overrides: pageId -> field label -> options. They win over the defaults.
// Add a page here when its section in docs/plan/04-modules.md gives its own vocabulary.
export const PAGE_ENUM_OVERRIDES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  'crm-leads': { Stage: ['New', 'Contacted', 'Qualified', 'Converted', 'Disqualified'] },
  'crm-followups': { Channel: ['Call', 'Email', 'WhatsApp', 'Visit', 'Meeting'] },
  'crm-meetings': { 'Location Mode': ['On-site', 'Customer site', 'Phone', 'Video'] },
};
