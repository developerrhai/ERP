// "Settings" panel of a module page (docs/phases/PHASE-06B.md §7): the formats and calculation rules
// of THIS page. Everybody with view can read; only the Department Head of the owner department and
// Administrators can change them (others see the buttons disabled with the reason on hover).
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { useToast } from '../../components/Toast';
import {
  listFormats,
  listRules,
  type FormatSchema,
  type RuleDefinition,
  type SettingsList,
  type SettingsVersion,
} from '../../lib/settingsApi';
import { useLoad } from '../../lib/useLoad';
import { FormatEditor } from './FormatEditor';
import { HistoryModal } from './HistoryModal';
import { ImportTab } from './ImportTab';
import { RuleEditor } from './RuleEditor';
import { READ_ONLY_HINT, statusClass, statusLabel } from './shared';

type Tab = 'formats' | 'rules' | 'import';
type Dialog =
  | { kind: 'format'; row: SettingsVersion<FormatSchema> | null }
  | { kind: 'rule'; row: SettingsVersion<RuleDefinition> | null }
  | { kind: 'history'; part: 'formats' | 'rules'; row: SettingsVersion }
  | null;

function Status({ value }: { value: string }) {
  return <span className={`status ${statusClass(value)}`}>{statusLabel(value)}</span>;
}

export function SettingsPanel({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('formats');
  const [dialog, setDialog] = useState<Dialog>(null);
  const formats = useLoad(() => listFormats(pageId), [pageId]);
  const rules = useLoad(() => listRules(pageId), [pageId]);
  const meta: SettingsList<unknown> | null = formats.data ?? rules.data;
  const canEdit = meta?.canEdit === true;
  const hint = canEdit ? undefined : READ_ONLY_HINT;
  const reload = (): void => {
    formats.reload();
    rules.reload();
  };
  const done = (message: string): void => {
    toast(message);
    setDialog(null);
    reload();
  };

  const error = formats.error || rules.error;
  return (
    <div className="settings-panel">
      <p className="v8-sub">
        Formats and calculation rules of <b>{pageTitle}</b>.{' '}
        {meta ? (
          <>
            Owned by <b>{meta.ownerDepartment}</b>.{' '}
            {canEdit ? 'You can change them.' : READ_ONLY_HINT + '.'}
          </>
        ) : null}
      </p>
      {error ? <ErrorMessage onReload={reload}>{error}</ErrorMessage> : null}
      <div className="tabs" role="tablist" aria-label="Settings">
        {(
          [
            ['formats', 'Formats'],
            ['rules', 'Rules'],
            ['import', 'Import from Excel'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'formats' ? (
        <section aria-label="Formats">
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={!canEdit}
              title={hint}
              onClick={() => setDialog({ kind: 'format', row: null })}
            >
              + New format
            </button>
          </div>
          {formats.loading ? <p role="status">Loading…</p> : null}
          {!formats.loading && (formats.data?.items.length ?? 0) === 0 ? (
            <p className="empty">No formats yet. {canEdit ? 'Click + New format.' : ''}</p>
          ) : null}
          {(formats.data?.items.length ?? 0) > 0 ? (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">For</th>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {formats.data?.items.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.name} <small>({f.kind})</small>
                      </td>
                      <td>
                        {f.customer ? `Customer: ${f.customer.name}` : 'All customers'}
                        {f.unit ? `, ${f.unit.name}` : ''}
                      </td>
                      <td>v{f.versionNo}</td>
                      <td>
                        <Status value={f.status} />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="btn sm"
                          disabled={!canEdit}
                          title={hint}
                          aria-label={`Edit ${f.name} v${f.versionNo}`}
                          onClick={() => setDialog({ kind: 'format', row: f })}
                        >
                          {f.status === 'DRAFT' ? 'Edit draft' : 'New version'}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`History of ${f.name}`}
                          onClick={() => setDialog({ kind: 'history', part: 'formats', row: f })}
                        >
                          History
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'rules' ? (
        <section aria-label="Rules">
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={!canEdit}
              title={hint}
              onClick={() => setDialog({ kind: 'rule', row: null })}
            >
              + New rule set
            </button>
          </div>
          {rules.loading ? <p role="status">Loading…</p> : null}
          {!rules.loading && (rules.data?.items.length ?? 0) === 0 ? (
            <p className="empty">No rule sets yet. {canEdit ? 'Click + New rule set.' : ''}</p>
          ) : null}
          {(rules.data?.items.length ?? 0) > 0 ? (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Rule set</th>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Results</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data?.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name} <small>({r.code})</small>
                        {r.moneyAffecting ? <small> · changes money</small> : null}
                      </td>
                      <td>v{r.versionNo}</td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td>{r.content.outputs.map((o) => o.name).join(', ')}</td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="btn sm"
                          disabled={!canEdit || r.status === 'PENDING_APPROVAL'}
                          title={
                            r.status === 'PENDING_APPROVAL'
                              ? 'This version is waiting for approval'
                              : hint
                          }
                          aria-label={`Edit ${r.name} v${r.versionNo}`}
                          onClick={() => setDialog({ kind: 'rule', row: r })}
                        >
                          {r.status === 'DRAFT' ? 'Edit draft' : 'New version'}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={`History of ${r.name}`}
                          onClick={() => setDialog({ kind: 'history', part: 'rules', row: r })}
                        >
                          History
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'import' ? (
        <ImportTab pageId={pageId} canEdit={canEdit} onImported={reload} />
      ) : null}

      {dialog?.kind === 'format' ? (
        <FormatEditor
          pageId={pageId}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'rule' ? (
        <RuleEditor
          pageId={pageId}
          row={dialog.row}
          approvalRequired={rules.data?.approvalRequired === true}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'history' ? (
        <HistoryModal
          pageId={pageId}
          part={dialog.part}
          row={dialog.row}
          canEdit={canEdit}
          onClose={() => setDialog(null)}
          onRestored={() => {
            toast('Restored as a new draft. Review it and publish.');
            setDialog(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
