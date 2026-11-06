// Live password checklist component per Phase 01 §7:
// ✓ 12+ characters, ✓ not a common password, ✓ passwords match.
import type { CSSProperties } from 'react';

const COMMON_PATTERNS = [
  'password',
  '123456',
  '12345678',
  'qwerty',
  'admin',
  'welcome',
  'sawant',
  'readyhand',
  'varale',
  'talwade',
  'sawardari',
  'erp',
];

export interface PasswordChecklistProps {
  password: string;
  confirmPassword?: string;
  contextWords?: string[];
  style?: CSSProperties;
}

export function PasswordChecklist({
  password,
  confirmPassword,
  contextWords = [],
  style,
}: PasswordChecklistProps) {
  const hasLength = password.length >= 12 && password.length <= 128;

  const lower = password.toLowerCase();
  const wordsToCheck = [...COMMON_PATTERNS, ...contextWords.filter(Boolean).map((w) => w.toLowerCase())];
  const isCommonOrContext = wordsToCheck.some((w) => w.length >= 3 && lower.includes(w));
  const notCommon = password.length > 0 && !isCommonOrContext;

  const matches =
    confirmPassword !== undefined && confirmPassword.length > 0 && password === confirmPassword;

  return (
    <div className="password-checklist" style={{ fontSize: '0.8125rem', marginTop: '0.5rem', ...style }}>
      <div style={{ color: hasLength ? 'var(--color-success, #16a34a)' : 'var(--color-muted, #64748b)' }}>
        {hasLength ? '✓' : '○'} 12+ characters (up to 128)
      </div>
      <div style={{ color: notCommon ? 'var(--color-success, #16a34a)' : 'var(--color-muted, #64748b)' }}>
        {notCommon ? '✓' : '○'} Not a common password or company word
      </div>
      {confirmPassword !== undefined ? (
        <div style={{ color: matches ? 'var(--color-success, #16a34a)' : 'var(--color-muted, #64748b)' }}>
          {matches ? '✓' : '○'} Passwords match
        </div>
      ) : null}
    </div>
  );
}
