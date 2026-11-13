// Phase 31 "View as": the chosen session is kept for this tab only and sent as X-View-As on every call.
let current: { id: string; name: string } | null = null;

try {
  const raw = window.sessionStorage.getItem('rhai.viewAs');
  if (raw) current = JSON.parse(raw) as { id: string; name: string };
} catch {
  current = null;
}

export function getViewAs(): { id: string; name: string } | null {
  return current;
}

export function setViewAs(v: { id: string; name: string } | null): void {
  current = v;
  try {
    if (v) window.sessionStorage.setItem('rhai.viewAs', JSON.stringify(v));
    else window.sessionStorage.removeItem('rhai.viewAs');
  } catch {
    /* storage may be blocked: the choice then lasts until the page is reloaded */
  }
}
