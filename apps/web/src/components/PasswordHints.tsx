// Live password-policy checklist: each rule turns green as it is met (CONTRACT §8).
import type { PolicyCheck } from '../lib/password-policy';

export function PasswordHints({ checks, note }: { checks: PolicyCheck[]; /** a rule the screen cannot tick itself */ note?: string }) {
  return (
    <>
      <ul className="pw-hints" aria-label="Password rules">
        {checks.map((c) => (
          <li key={c.id} className={c.ok ? 'ok' : undefined}>
            {c.label}
            <span className="sr-only">{c.ok ? ' (met)' : ' (not met)'}</span>
          </li>
        ))}
      </ul>
      <p className="pw-note">
        {note ? `${note} ` : ''}Common passwords are refused when you save. Capitals, numbers and symbols are not required.
      </p>
    </>
  );
}
