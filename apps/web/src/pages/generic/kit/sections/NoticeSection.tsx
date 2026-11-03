// apps/web/src/pages/generic/kit/sections/NoticeSection.tsx
// Notice banner section using .v9-health (docs/plans/07-ENGINE-KIT.md §2.3)

export function NoticeSection({
  tone,
  text,
}: {
  tone: 'info' | 'warn' | 'bad';
  text: string;
}) {
  const toneClass =
    tone === 'bad'
      ? 'v9-health notice-bad'
      : tone === 'warn'
        ? 'v9-health notice-warn'
        : 'v9-health notice-info';

  return (
    <div className={toneClass} role="status">
      <b>{tone.toUpperCase()}:</b>
      <span>{text}</span>
    </div>
  );
}
