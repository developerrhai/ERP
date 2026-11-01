// Accessible dialog using the prototype .modal-bg/.modal markup (lines 17 of the prototype CSS),
// with focus trap and Escape-to-close; used for Add/Edit user, reset password and confirms.
import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';

interface ModalProps {
  title: string;
  sub?: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'lg';
}

export function Modal({ title, sub, onClose, footer, children, size = 'lg' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, true, onClose);
  return (
    <div className="modal-bg show">
      <div
        ref={ref}
        className={size === 'sm' ? 'modal sm' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <b id={titleId}>{title}</b>
            {sub ? <div className="modal-sub">{sub}</div> : null}
          </div>
          <button type="button" className="close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}
