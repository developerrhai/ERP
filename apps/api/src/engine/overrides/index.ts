// Looks up the options of an enum field: the page override first, then the prototype default.
// No entry means "free text" (the schema then carries a maxLength instead of options).
import { DEFAULT_ENUM_OPTIONS } from './defaults';
import { PAGE_ENUM_OVERRIDES } from './pages';

export function enumOptionsFor(pageId: string, label: string): string[] | undefined {
  const page = PAGE_ENUM_OVERRIDES[pageId]?.[label];
  if (page) return [...page];
  const fallback = DEFAULT_ENUM_OPTIONS[label.trim().toLowerCase()];
  return fallback ? [...fallback] : undefined;
}
