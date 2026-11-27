// Phase 20-F: "?" Help Drawer + What's New & Department Guide Quick Links.
import { useTranslation } from 'react-i18next';
import { Drawer } from './Drawer';

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <Drawer title={t('app.help')} onClose={onClose}>
      <section className="x-mb-16px">
        <h3 className="x-mt-0 x-fs-14px">{t('app.whatsNew')} (Phase 20)</h3>
        <ul className="x-pl-18px x-fs-13px x-lh-1_6">
          <li>Hindi UI (`EN / हिं`) saved to your user profile.</li>
          <li>Multi-process HA runtime with PostgreSQL rate limits & LISTEN/NOTIFY permission sync.</li>
          <li>Opening-balance cut-over reconciliation PDF & CFO/Dept Head sign-off.</li>
          <li>DPDP Act 2023 privacy notices (English, Hindi, Marathi) & 30-day request register.</li>
          <li>Keyboard shortcuts: Tab to navigate, Enter to submit, Esc to close dialogs.</li>
        </ul>
      </section>
      <section>
        <h3 className="x-fs-14px">Quick Guides & Role Runbooks</h3>
        <p className="x-fs-13px x-c-muted">
          Department role guides (EN / HI / MR) live in <code>docs/guides/</code>: Finance, Sales,
          Purchase, Warehouse, Production, Quality, Maintenance, HR/Payroll, Logistics, Admin.
        </p>
      </section>
    </Drawer>
  );
}

