// apps/web/src/pages/generic/kit/CommandBar.tsx
// Header command bar rendering kit commands after frozen buttons (docs/plans/07-ENGINE-KIT.md §2.6, §12 T-KIT-10)

import { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { ApiError } from '../../../lib/api';
import type { ActionSet } from '../../../types';
import type { KitCommand, PageSchema } from '../engineApi';
import { newIdempotencyKey } from '../engineApi';
import { runCommand } from './kitApi';
import { PayloadDialog } from './PayloadDialog';

export interface CommandBarProps {
  schema: PageSchema;
  perms: ActionSet;
  onDone?: () => void;
}

export function CommandBar({ schema, perms, onDone }: CommandBarProps) {
  const toast = useToast();
  const [activeCmd, setActiveCmd] = useState<KitCommand | null>(null);
  const [confirmCmd, setConfirmCmd] = useState<KitCommand | null>(null);
  const [running, setRunning] = useState(false);

  const commands = schema.commands ?? [];
  const visibleCommands = commands.filter((cmd) => {
    const required = cmd.requires ?? 'add';
    return perms[required] === true;
  });

  if (visibleCommands.length === 0) return null;

  const executeCommand = async (cmd: KitCommand, payload?: Record<string, unknown>) => {
    setRunning(true);
    try {
      const key = newIdempotencyKey();
      const res = await runCommand(schema.pageId, cmd.key, payload, key);
      toast(res.message ?? `${cmd.label} completed successfully.`);
      setActiveCmd(null);
      setConfirmCmd(null);
      onDone?.();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        toast(err.message ?? `${cmd.label} failed.`);
      } else {
        toast(`${cmd.label} failed.`);
      }
      throw err;
    } finally {
      setRunning(false);
    }
  };

  const handleCommandClick = (cmd: KitCommand) => {
    if (cmd.fields && cmd.fields.length > 0) {
      setActiveCmd(cmd);
    } else if (cmd.confirm) {
      setConfirmCmd(cmd);
    } else {
      void executeCommand(cmd);
    }
  };

  return (
    <>
      <div className="command-bar" style={{ display: 'inline-flex', gap: '8px' }}>
        {visibleCommands.map((cmd) => (
          <button
            key={cmd.key}
            type="button"
            className={`btn ${cmd.variant ?? ''}`}
            disabled={running}
            onClick={() => handleCommandClick(cmd)}
          >
            {cmd.label}
          </button>
        ))}
      </div>

      {activeCmd && activeCmd.fields ? (
        <PayloadDialog
          title={activeCmd.label}
          fields={activeCmd.fields}
          confirmText={activeCmd.label}
          onClose={() => setActiveCmd(null)}
          onSubmit={(payload) => executeCommand(activeCmd, payload)}
        />
      ) : null}

      {confirmCmd ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-cmd-title"
        >
          <div className="modal" style={{ maxWidth: '420px', padding: '20px' }}>
            <h3 id="confirm-cmd-title">{confirmCmd.label}</h3>
            <p style={{ margin: '12px 0 20px', fontSize: '13px' }}>{confirmCmd.confirm}</p>
            <div
              className="actions"
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
            >
              <button
                type="button"
                className="btn"
                disabled={running}
                onClick={() => setConfirmCmd(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${confirmCmd.variant ?? 'primary'}`}
                disabled={running}
                onClick={() => void executeCommand(confirmCmd)}
              >
                {running ? 'Working…' : confirmCmd.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
