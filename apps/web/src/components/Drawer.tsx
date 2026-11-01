// Right-hand slide-in panel using the prototype .drawer styles; mounted only while open so
// hidden content is never tabbable, with focus trap and Escape-to-close.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ title, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const [shown, setShown] = useState(false);
  useFocusTrap(ref, true, onClose);
  useEffect(() => {
    // Add .show on the next frame so the prototype's translateX transition plays.
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <aside
      ref={ref}
      className={shown ? 'drawer show' : 'drawer'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="drawer-head">
        <b id={titleId}>{title}</b>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
