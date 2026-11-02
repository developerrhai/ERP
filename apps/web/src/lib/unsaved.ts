// Registry of pages that hold unsaved edits, so a global action (switching unit / FY) can ask
// "Discard unsaved changes?" first. Pages opt in with useUnsavedGuard(isDirty).
import { useEffect } from 'react';

const dirty = new Set<symbol>();

/** Registers this component as having unsaved edits while `isDirty` is true (and mounted). */
export function useUnsavedGuard(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return undefined;
    const token = Symbol('unsaved');
    dirty.add(token);
    return () => {
      dirty.delete(token);
    };
  }, [isDirty]);
}

export function hasUnsavedChanges(): boolean {
  return dirty.size > 0;
}

export function resetUnsavedForTests(): void {
  dirty.clear();
}
