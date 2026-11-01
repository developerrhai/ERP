// Validates the ?next= return path after login so it can only point inside this app
// (prevents open redirects such as ?next=//evil.example).

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next === '/login' || next.startsWith('/login?')) return '/';
  return next;
}

export function loginPathFor(pathname: string, search: string): string {
  const here = `${pathname}${search}`;
  return here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`;
}
