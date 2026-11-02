// Error banner (.msg.error) that, for a 409 VERSION_CONFLICT, offers a "Reload" button which
// refetches only the conflicting record so the admin's other unsaved edits survive.
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When given, a Reload button is shown (used for VERSION_CONFLICT). */
  onReload?: () => void;
  reloadLabel?: string;
}

export function ErrorMessage({ children, onReload, reloadLabel = 'Reload' }: Props) {
  return (
    <div className="msg error show static msg-with-action" role="alert">
      <span>{children}</span>
      {onReload ? (
        <button type="button" className="btn sm" onClick={onReload}>
          {reloadLabel}
        </button>
      ) : null}
    </div>
  );
}
