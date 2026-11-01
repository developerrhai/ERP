// Keeps keyboard focus inside an open modal/drawer, closes it on Escape and returns focus
// to the element that opened it (accessibility requirement for dialogs).
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
  onEscape: () => void,
): void {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusableIn(root).find((el) => !el.classList.contains('close'));
    (first ?? root).focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(root);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl?.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl?.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [ref, active]);
}
