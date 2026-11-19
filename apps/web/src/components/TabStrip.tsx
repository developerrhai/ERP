// A horizontal strip of pill tabs with left (<) and right (>) scroll arrows (QA ERP-UI-01): when the tabs are wider than the
// screen the arrows appear and scroll the strip, so every tab (Rate Cards, Analytics & Graphs, Audit Trail, ...) can be reached.
// The arrows follow the real scroll position: the left one is off at the start, the right one at the end.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function TabStrip({
  children,
  id,
  className = 'tabs',
  label = 'Tabs',
  watch,
  role = 'tablist',
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  label?: string;
  /** Anything that changes the tab widths or the active tab (the active one is scrolled into view). */
  watch?: unknown;
  role?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ overflow: false, left: false, right: false });

  const measure = useCallback((): void => {
    const el = strip.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 2;
    setState({
      overflow,
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return undefined;
    measure();
    window.addEventListener('resize', measure);
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
    return () => {
      window.removeEventListener('resize', measure);
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, watch]);

  useEffect(() => {
    const el = strip.current;
    const active = el?.querySelector<HTMLElement>('[aria-selected="true"], .active');
    if (el && active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [watch]);

  const scroll = (dir: number): void => {
    const el = strip.current;
    if (!el) return;
    const by = dir * Math.max(160, Math.round(el.clientWidth * 0.7));
    if (typeof el.scrollBy === 'function') el.scrollBy({ left: by, behavior: 'smooth' });
    else el.scrollLeft += by;
  };

  return (
    <div className="tab-strip" data-overflow={state.overflow ? 'true' : 'false'}>
      <button
        type="button"
        className="tab-arrow"
        aria-label="Scroll tabs left"
        title="Scroll left"
        hidden={!state.overflow}
        disabled={!state.left}
        onClick={() => scroll(-1)}
      >
        ‹
      </button>
      <div className={className} id={id} role={role} aria-label={label} ref={strip}>
        {children}
      </div>
      <button
        type="button"
        className="tab-arrow"
        aria-label="Scroll tabs right"
        title="Scroll right"
        hidden={!state.overflow}
        disabled={!state.right}
        onClick={() => scroll(1)}
      >
        ›
      </button>
    </div>
  );
}
