// Template & Feature: checklists, audit forms, record document formats, the inspection / form templates in force and
// the feature switches of the Quality module.
import { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { qdelete, qget, qpatch, qput } from '../../../lib/qmsApi';
import { useLoad } from '../../../lib/useLoad';
import type { ActionSet } from '../../../types';
import { Empty, ErrorBox } from '../../finance/shared';
import { useFrame } from '../../frame/V40TabFrame';
import { Confirm, recordOf, useWmsActions as useActions, WmsRegister as Register } from '../../wms/WmsRegister';
import { OwnTab } from './NcrDesk';
import { FormatForm, FormatView, RecordFormats, type Category, type Format } from './RecordFormats';
import { messageOf } from './shared';

const PAGE = 'qms-templates';

interface Feature {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedByName: string | null;
}
function Features({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const load = useLoad(() => qget<{ rows: Feature[] }>('/features'), [tick]);
  const flip = (f: Feature): void => {
    qput(`/features/${f.key}`, { enabled: !f.enabled })
      .then(() => toast(`${f.label} switched ${f.enabled ? 'off' : 'on'}.`))
      .catch((e: unknown) => toast(messageOf(e)))
      .finally(() => setTick((n) => n + 1));
  };
  return (
    <>
      <p className="qv-note">{actions.controls ? 'Each switch changes what the ERP does at once.' : 'Only the Quality Head, the MR or an administrator can change a switch.'}</p>
      <ErrorBox message={load.error} />
      <ul className="qv-switches">
        {(load.data?.rows ?? []).map((f) => (
          <li key={f.key} className="card">
            <div>
              <b>{f.label}</b>
              <p>{f.description}</p>
              {f.updatedByName ? <small>Last changed by {f.updatedByName}</small> : null}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={f.enabled}
              aria-label={f.label}
              className={`qv-toggle${f.enabled ? ' on' : ''}`}
              disabled={!actions.controls}
              onClick={() => flip(f)}
            >
              {f.enabled ? 'On' : 'Off'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

interface Tpl {
  id: string;
  code: string;
  name: string;
  kind: string;
  version: number;
  status: string;
  customerName?: string | null;
  headerFields: unknown[];
}
function SheetTemplates() {
  const load = useLoad(() => qget<{ rows: Tpl[] }>('/templates', { status: 'ACTIVE' }), []);
  const rows = load.data?.rows ?? [];
  return (
    <>
      <p className="qv-note">
        The inspection sheets and quality forms in force. New versions are published on the <a href="/m/qms-plans">Inspection Plans</a> page.
      </p>
      <ErrorBox message={load.error} />
      <div className="card table-wrap">
        <table className="register-table plain">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Form</th>
              <th>Version</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.kind.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="num">{r.version}</td>
                <td className="num">{r.headerFields?.length ?? 0}</td>
              </tr>
            ))}
            {rows.length === 0 && !load.loading ? <Empty cols={5}>No active template.</Empty> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function TemplatesDesk({ actions, title, sub }: { actions: ActionSet; title: string; sub: string }) {
  const tab = useFrame()?.tabName ?? '';
  const act = useActions();
  const type: Format['type'] = tab === 'Audit Forms' ? 'AUDIT_FORM' : 'CHECKLIST';
  const [form, setForm] = useState<{ id: string | null; type: Format['type'] } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ id: string; code: string } | null>(null);
  const categories = useLoad(() => qget<{ rows: Category[] }>('/categories'), [act.reloadKey, tab]);

  const dialogs = (
    <>
      {form ? (
        <FormatForm
          type={form.type}
          id={form.id}
          categories={categories.data?.rows ?? []}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            act.reload();
          }}
        />
      ) : null}
      {view && !form ? <FormatView id={view} actions={actions} onClose={() => setView(null)} onEdit={(id) => setForm({ id, type })} /> : null}
      {remove ? (
        <Confirm
          title={`Delete ${remove.code}?`}
          text="It leaves every list. Retire it instead if it was ever used."
          action="Delete"
          onClose={() => setRemove(null)}
          onConfirm={() => {
            const r = remove;
            setRemove(null);
            void act.run(() => qdelete(`/formats/${r.id}`), `${r.code} deleted.`);
          }}
        />
      ) : null}
    </>
  );

  if (tab === 'Record Doc. Format' || tab === 'Feature Switches' || tab === 'Inspection & Form Templates')
    return (
      <div className="qv-page">
        <OwnTab pageId={PAGE} title={title} sub={sub} actions={actions} add={[]}>
          {tab === 'Record Doc. Format' ? <RecordFormats actions={actions} /> : tab === 'Feature Switches' ? <Features actions={actions} /> : <SheetTemplates />}
        </OwnTab>
      </div>
    );

  const add = [
    ...(tab === 'Audit Forms' ? [] : [{ label: '＋ Add Checklist', onClick: () => setForm({ id: null, type: 'CHECKLIST' }) }]),
    ...(tab === 'Checklists' ? [] : [{ label: '＋ Add Audit Form', onClick: () => setForm({ id: null, type: 'AUDIT_FORM' }) }]),
  ];
  return (
    <div className="qv-page">
      <Register
        pageId={PAGE}
        title={title}
        sub={sub}
        actions={actions}
        add={add}
        error={act.error}
        reloadKey={act.reloadKey}
        reload={act.reload}
        onOpen={setView}
        onEdit={actions.edit ? (id) => setForm({ id, type }) : undefined}
        canEditRow={() => true}
        rowExtra={(r) => {
          const id = recordOf(r);
          return (
            <>
              {actions.edit ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void act.run(async () => {
                      const f = await qget<Format>(`/formats/${id}`);
                      await qpatch(`/formats/${id}`, f.version, { status: f.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE' });
                    }, `${r.number} ${r.status === 'ACTIVE' ? 'retired' : 'activated'}.`)
                  }
                >
                  {r.status === 'ACTIVE' ? 'Retire' : 'Activate'}
                </button>
              ) : null}
              {actions.delete ? (
                <button type="button" className="btn sm danger" onClick={() => setRemove({ id, code: r.number })}>
                  Delete
                </button>
              ) : null}
            </>
          );
        }}
      >
        {dialogs}
      </Register>
    </div>
  );
}
