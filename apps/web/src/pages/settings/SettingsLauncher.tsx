// The "Settings" button every module page carries (PHASE-06B §2). It opens the page's formats and
// rules in a side panel; the panel itself decides who may change them.
import { useState } from 'react';
import { Drawer } from '../../components/Drawer';
import { SettingsPanel } from './SettingsPanel';

export function SettingsLauncher({ pageId, title }: { pageId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="settings-bar">
        <button
          type="button"
          className="btn sm"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          ⚙ Settings
        </button>
      </div>
      {open ? (
        <Drawer title={`Settings — ${title}`} onClose={() => setOpen(false)}>
          <SettingsPanel pageId={pageId} pageTitle={title} />
        </Drawer>
      ) : null}
    </>
  );
}
