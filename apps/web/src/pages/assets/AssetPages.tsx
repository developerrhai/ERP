// Phase 14 asset pages: Machine Master, Equipment Master and the Asset Register are three views of the same rows (one physical
// object = one row). Book value is computed on the server from cost less depreciation; nothing here stores it.
import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { aget, alist, apatch, apost, aput, printLabels } from '../../lib/assetApi';
import type { Row } from '../../lib/assetApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { dmy, ErrorBox, inr, PageHead, Pill } from '../finance/shared';
import { Tabs } from '../qms/Shared';
import { Act, Dialog, FormModal, Grid, TONE, num, s, todayIso, useAssetOptions } from './Shared';

const CRIT = ['A', 'B', 'C'];

/** What the edit form starts with: the asset's own values as text. */
function assetInitial(asset: Row): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [
    'name',
    'parentAssetId',
    'location',
    'department',
    'make',
    'model',
    'serialNo',
    'criticality',
    'commissionDate',
    'warrantyEnd',
    'supplierId',
  ]) {
    const v = asset[k];
    if (v === null || v === undefined) continue;
    out[k] = k === 'commissionDate' || k === 'warrantyEnd' ? s(v).slice(0, 10) : s(v);
  }
  out.isMaintainable = asset.isMaintainable === true ? 'true' : '';
  return out;
}

function useCategories() {
  return useLoad(() => aget<Row[]>('/assets/categories'), []);
}

// ------------------------------------------------------------------------------------------------ the three views
export function MachinesPage({ actions }: { actions: ActionSet }) {
  return (
    <AssetListPage
      page="maint-machines"
      base="/maint/machines"
      title="Machine Master"
      sub="Every machine of the plant, with how reliable it is: failures, MTBF, last and next service, and its health."
      actions={actions}
    />
  );
}
export function EquipmentPage({ actions }: { actions: ActionSet }) {
  return (
    <AssetListPage
      page="maint-equipment"
      base="/maint/equipment"
      title="Equipment Master"
      sub="Equipment and parts of machines. A part can belong to a machine (for example a spindle motor of a CNC)."
      actions={actions}
    />
  );
}
export function AssetMasterPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'register' | 'categories'>('register');
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['register', 'Asset register'],
          ['categories', 'Categories and lives'],
        ]}
      />
      {tab === 'register' ? (
        <AssetListPage
          page="asset-master"
          base="/assets/register"
          title="Asset Master"
          sub="Every asset of the company with its cost, depreciation to date and book value. Book value is worked out, never typed."
          actions={actions}
          finance
        />
      ) : (
        <CategoriesTab actions={actions} />
      )}
    </>
  );
}

function AssetListPage({
  page,
  base,
  title,
  sub,
  actions,
  finance,
}: {
  page: string;
  base: string;
  title: string;
  sub: string;
  actions: ActionSet;
  finance?: boolean;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const list = useLoad(() => alist(base, { q, status }), [base, q, status]);
  return (
    <>
      <PageHead title={title} sub={sub} />
      <div className="toolbar">
        <input
          aria-label="Search assets"
          placeholder="Search number, name or serial"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['CWIP', 'ACTIVE', 'IDLE', 'UNDER_MAINT', 'DISPOSED'].map((x) => (
            <option key={x} value={x}>
              {x.replace('_', ' ')}
            </option>
          ))}
        </select>
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEdit('new')}>
            + New {finance ? 'asset' : title.split(' ')[0]!.toLowerCase()}
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No assets yet. Click + New to add one."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Asset no.', r: (r) => s(r.assetNo) },
          { h: 'Name', r: (r) => s(r.name) },
          { h: 'Category', r: (r) => s(r.categoryName) },
          { h: 'Location', r: (r) => s(r.location) || '—' },
          { h: 'Criticality', r: (r) => s(r.criticality) },
          ...(finance
            ? [
                { h: 'Cost', r: (r: Row) => inr(s(r.cost)) },
                { h: 'Book value', r: (r: Row) => inr(s(r.bookValue)) },
              ]
            : []),
          {
            h: 'Status',
            r: (r) => <Pill tone={TONE[s(r.status)]}>{s(r.status).replace('_', ' ')}</Pill>,
          },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setView(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {view ? (
        <AssetView
          id={view}
          actions={actions}
          finance={!!finance}
          onClose={() => setView(null)}
          onChanged={() => list.reload()}
          onEdit={(r) => {
            setView(null);
            setEdit(r);
          }}
          base={base}
        />
      ) : null}
      {edit ? (
        <AssetForm
          asset={edit === 'new' ? null : edit}
          base={base}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
      {page ? null : null}
    </>
  );
}

function AssetForm({
  asset,
  base,
  onClose,
  onSaved,
}: {
  asset: Row | null;
  base: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const cats = useCategories();
  const parents = useAssetOptions();
  return (
    <FormModal
      title={asset ? `Edit ${s(asset.assetNo)}` : 'New asset'}
      fields={[
        { key: 'name', label: 'Name', required: true },
        ...(asset
          ? []
          : [
              {
                key: 'categoryId',
                label: 'Category',
                type: 'select' as const,
                required: true,
                options: (cats.data ?? []).map((c) => ({
                  id: s(c.id),
                  label: `${s(c.code)} · ${s(c.name)}`,
                })),
              },
            ]),
        {
          key: 'parentAssetId',
          label: 'Part of (parent asset)',
          type: 'select' as const,
          options: (parents.data ?? []).filter((o) => o.id !== s(asset?.id)),
        },
        { key: 'location', label: 'Location' },
        { key: 'department', label: 'Department' },
        { key: 'make', label: 'Make' },
        { key: 'model', label: 'Model' },
        { key: 'serialNo', label: 'Serial number' },
        {
          key: 'criticality',
          label: 'Criticality (A = most important)',
          type: 'select' as const,
          options: CRIT,
        },
        { key: 'commissionDate', label: 'Commissioned on', type: 'date' as const },
        { key: 'warrantyEnd', label: 'Warranty ends', type: 'date' as const },
        { key: 'supplierId', label: 'Supplier', type: 'supplier' as const },
        {
          key: 'isMaintainable',
          label: 'Needs maintenance (PM plans, breakdowns)',
          type: 'check' as const,
        },
      ]}
      initial={asset ? assetInitial(asset) : { criticality: 'C' }}
      onClose={onClose}
      onSubmit={async (v) => {
        const body: Record<string, unknown> = { ...v, isMaintainable: v.isMaintainable === 'true' };
        if (asset) await apatch(`${base}/${s(asset.id)}`, Number(asset.version), body);
        else await apost(base, body);
        toast('Saved');
        onSaved();
      }}
    />
  );
}

function AssetView({
  id,
  base,
  actions,
  finance,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string;
  base: string;
  actions: ActionSet;
  finance: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (r: Row) => void;
}) {
  const doc = useLoad(() => aget(`/assets/by-id/${id}`), [id]);
  const a = doc.data;
  const [reading, setReading] = useState<Record<string, string>>({});
  const [meterType, setMeterType] = useState('RUN_HRS');
  const after = () => {
    doc.reload();
    onChanged();
  };
  const st = s(a?.status);
  return (
    <Dialog
      title={a ? `${s(a.assetNo)} · ${s(a.name)}` : 'Asset'}
      sub={a ? `${s(a.categoryName)} · ${st.replace('_', ' ')}` : ''}
      onClose={onClose}
      error={doc.error}
      footer={
        a ? (
          <>
            {actions.edit && st !== 'DISPOSED' ? (
              <button type="button" className="btn" onClick={() => onEdit(a)}>
                Edit
              </button>
            ) : null}
            {actions.edit && st === 'ACTIVE' ? (
              <Act
                label="Mark idle"
                run={() => apatch(`${base}/${id}`, Number(a.version), { status: 'IDLE' })}
                done={after}
              />
            ) : null}
            {actions.edit && st === 'IDLE' ? (
              <Act
                label="Back in use"
                run={() => apatch(`${base}/${id}`, Number(a.version), { status: 'ACTIVE' })}
                done={after}
              />
            ) : null}
            <Act label="Print QR label" run={() => printLabels([id])} ok="Label opened" />
          </>
        ) : null
      }
    >
      {a ? (
        <>
          <p>
            Health{' '}
            <Pill tone={TONE[s(a.health)]}>
              {s(a.health) === 'GOOD' ? 'Good' : s(a.health) === 'WATCH' ? 'Watch' : 'Down'}
            </Pill>{' '}
            · failures <b>{s(a.failures)}</b> · MTBF{' '}
            <b>{a.mtbfHours ? `${s(a.mtbfHours)} h` : '—'}</b> · MTTR{' '}
            <b>{a.mttrHours ? `${s(a.mttrHours)} h` : '—'}</b> · availability{' '}
            <b>{a.availabilityPct ? `${s(a.availabilityPct)} %` : '—'}</b>
          </p>
          <p>
            Last service <b>{a.lastService ? dmy(s(a.lastService).slice(0, 10)) : '—'}</b> · next
            service <b>{a.nextService ? dmy(s(a.nextService).slice(0, 10)) : '—'}</b> · warranty{' '}
            <b>{a.warrantyEnd ? dmy(s(a.warrantyEnd).slice(0, 10)) : '—'}</b>
          </p>
          <p>
            {s(a.make) || '—'} {s(a.model)} · serial {s(a.serialNo) || '—'} ·{' '}
            {s(a.location) || 'no location'} · {s(a.department) || 'no department'}
            {a.parentAssetNo ? ` · part of ${s(a.parentAssetNo)}` : ''}
          </p>
          {finance ? (
            <p>
              Cost <b>{inr(s(a.cost))}</b> · depreciation to date <b>{inr(s(a.accumDep))}</b> · book
              value <b>{inr(s(a.bookValue))}</b>
              {((a.profiles as Row[]) ?? []).map((p) => (
                <span key={s(p.id)}>
                  {' '}
                  · {s(p.area)}: {s(p.method)}{' '}
                  {p.lifeMonths ? `${s(p.lifeMonths)} months` : `${num(p.ratePct)} %`}
                </span>
              ))}
            </p>
          ) : null}
          <h4>Meters</h4>
          <Grid
            rows={(a.meters as Row[]) ?? []}
            rowKey={(m) => s(m.id)}
            empty="No meters. Add one to plan service by running hours."
            cols={[
              { h: 'Meter', r: (m) => s(m.meterType).replace('_', ' ') },
              {
                h: 'Last reading',
                r: (m) => (m.lastValue ? `${num(m.lastValue)} ${s(m.uom)}` : '—'),
              },
              {
                h: 'New reading',
                r: (m) =>
                  actions.edit ? (
                    <>
                      <input
                        aria-label={`Reading ${s(m.meterType)}`}
                        type="number"
                        min={0}
                        step="any"
                        value={reading[s(m.id)] ?? ''}
                        onChange={(e) => setReading((o) => ({ ...o, [s(m.id)]: e.target.value }))}
                      />
                      <Act
                        label="Save"
                        run={() =>
                          apost(`/assets/meters/${s(m.id)}/readings`, { value: reading[s(m.id)] })
                        }
                        done={() => {
                          setReading({});
                          after();
                        }}
                      />
                    </>
                  ) : null,
              },
            ]}
          />
          {actions.edit ? (
            <div className="toolbar">
              <select
                aria-label="Meter type"
                value={meterType}
                onChange={(e) => setMeterType(e.target.value)}
              >
                <option value="RUN_HRS">Running hours</option>
                <option value="STROKES">Strokes</option>
                <option value="KM">Kilometres</option>
              </select>
              <Act
                label="Add meter"
                run={() => apost(`/assets/by-id/${id}/meters`, { meterType })}
                done={after}
              />
            </div>
          ) : null}
          {((a.children as Row[]) ?? []).length ? (
            <>
              <h4>Parts</h4>
              <Grid
                rows={(a.children as Row[]) ?? []}
                rowKey={(c) => s(c.id)}
                cols={[
                  { h: 'Asset no.', r: (c) => s(c.assetNo) },
                  { h: 'Name', r: (c) => s(c.name) },
                  { h: 'Status', r: (c) => s(c.status).replace('_', ' ') },
                ]}
              />
            </>
          ) : null}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ categories
function CategoriesTab({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useCategories();
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const [params, setParams] = useState<Row | null>(null);
  const cur = edit && edit !== 'new' ? edit : null;
  return (
    <>
      <PageHead
        title="Categories and lives"
        sub="Schedule II useful lives are seeded for review; confirm or change each one before the first depreciation run."
      />
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setEdit('new')}>
            + New category
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data ?? []}
        loading={list.loading}
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Code', r: (r) => s(r.code) },
          { h: 'Name', r: (r) => s(r.name) },
          {
            h: 'Asset / depreciation accounts',
            r: (r) => `${s(r.assetAccount)} / ${s(r.accumDepAccount) || '—'}`,
          },
          {
            h: 'GST credit',
            r: (r) => (r.itcEligible === true ? 'Claimable' : 'Blocked (added to cost)'),
          },
          {
            h: 'Life · method · residual',
            r: (r) => {
              const p = ((r.params as Row[]) ?? [])[0];
              return p ? (
                <>
                  {Math.round(Number(p.usefulLifeMonths) / 12)} yrs · {s(p.method)} ·{' '}
                  {num(p.residualPct)} %{' '}
                  {p.needsReview === true ? <Pill tone="pending">To review</Pill> : null}
                </>
              ) : (
                'Not set'
              );
            },
          },
          {
            h: '',
            r: (r) =>
              actions.edit ? (
                <>
                  <button type="button" className="btn" onClick={() => setEdit(r)}>
                    Edit
                  </button>
                  <button type="button" className="btn" onClick={() => setParams(r)}>
                    Set life
                  </button>
                </>
              ) : null,
          },
        ]}
      />
      {edit ? (
        <FormModal
          title={cur ? `Edit ${s(cur.code)}` : 'New category'}
          fields={[
            ...(cur ? [] : [{ key: 'code', label: 'Code', required: true }]),
            { key: 'name', label: 'Name', required: true },
            {
              key: 'assetClass',
              label: 'Class',
              type: 'select' as const,
              required: true,
              options: [
                'BUILDING',
                'PM',
                'FURNITURE',
                'VEHICLE',
                'COMPUTER',
                'OFFICE_EQUIP',
                'ELECTRICAL',
                'INTANGIBLE',
              ],
            },
            { key: 'assetAccount', label: 'Asset account (code)', required: true },
            { key: 'accumDepAccount', label: 'Accumulated depreciation account' },
            { key: 'expenseAccount', label: 'Depreciation expense account' },
            { key: 'cwipAccount', label: 'Capital work in progress account' },
            { key: 'itBlockCode', label: 'Income-tax block' },
            { key: 'itcEligible', label: 'GST credit can be claimed', type: 'check' as const },
            {
              key: 'isMaintainableDefault',
              label: 'Assets need maintenance by default',
              type: 'check' as const,
            },
            { key: 'nesd', label: 'No extra shift depreciation (NESD)', type: 'check' as const },
          ]}
          initial={
            cur
              ? {
                  ...Object.fromEntries(
                    [
                      'name',
                      'assetClass',
                      'assetAccount',
                      'accumDepAccount',
                      'expenseAccount',
                      'cwipAccount',
                      'itBlockCode',
                    ]
                      .filter((k) => cur[k])
                      .map((k) => [k, s(cur[k])]),
                  ),
                  itcEligible: cur.itcEligible === true ? 'true' : '',
                  isMaintainableDefault: cur.isMaintainableDefault === true ? 'true' : '',
                  nesd: cur.nesd === true ? 'true' : '',
                }
              : { itcEligible: 'true' }
          }
          onClose={() => setEdit(null)}
          onSubmit={async (v) => {
            const body = {
              ...v,
              itcEligible: v.itcEligible === 'true',
              isMaintainableDefault: v.isMaintainableDefault === 'true',
              nesd: v.nesd === 'true',
            };
            if (cur) await aput(`/assets/categories/${s(cur.id)}`, body);
            else await apost('/assets/categories', body);
            toast('Saved');
            setEdit(null);
            list.reload();
          }}
        />
      ) : null}
      {params ? (
        <FormModal
          title={`Useful life of ${s(params.name)}`}
          sub="Schedule II: the residual value is at most 5 % of cost."
          fields={[
            { key: 'effectiveFrom', label: 'From', type: 'date', required: true },
            {
              key: 'method',
              label: 'Method',
              type: 'select',
              required: true,
              options: ['SLM', 'WDV'],
            },
            {
              key: 'usefulLifeMonths',
              label: 'Useful life in months',
              type: 'number',
              required: true,
            },
            { key: 'residualPct', label: 'Residual %', type: 'number', required: true },
            { key: 'sch2Ref', label: 'Schedule II reference' },
          ]}
          initial={{ effectiveFrom: todayIso(), method: 'SLM', residualPct: '5' }}
          onClose={() => setParams(null)}
          onSubmit={async (v) => {
            await aput(`/assets/categories/${s(params.id)}/book-params`, {
              ...v,
              usefulLifeMonths: Number(v.usefulLifeMonths),
            });
            toast('Saved');
            setParams(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------------ QR, scan, physical verification
export function QrPage({ actions }: { actions: ActionSet }) {
  const [tab, setTab] = useState<'labels' | 'scan' | 'verify'>('labels');
  return (
    <>
      <PageHead
        title="QR and Verification"
        sub="Print labels for assets, scan them with a phone, and count the register against the floor."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['labels', 'Labels'],
          ['scan', 'Scan'],
          ['verify', 'Physical verification'],
        ]}
      />
      {tab === 'labels' ? <Labels actions={actions} /> : null}
      {tab === 'scan' ? <ScanTab /> : null}
      {tab === 'verify' ? <Verification actions={actions} /> : null}
    </>
  );
}

function Labels({ actions }: { actions: ActionSet }) {
  const list = useLoad(() => alist('/assets/register', { size: 200 }), []);
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <>
      <div className="toolbar">
        {actions.print ? (
          <Act
            label={`Print ${picked.length || ''} label${picked.length === 1 ? '' : 's'}`.replace(
              '  ',
              ' ',
            )}
            primary
            disabled={!picked.length}
            run={() => printLabels(picked)}
            ok="Labels opened"
          />
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No assets yet."
        rowKey={(r) => s(r.id)}
        cols={[
          {
            h: '',
            r: (r) => (
              <input
                type="checkbox"
                aria-label={`Select ${s(r.assetNo)}`}
                checked={picked.includes(s(r.id))}
                onChange={(e) =>
                  setPicked((o) =>
                    e.target.checked ? [...o, s(r.id)] : o.filter((x) => x !== s(r.id)),
                  )
                }
              />
            ),
          },
          { h: 'Asset no.', r: (r) => s(r.assetNo) },
          { h: 'Name', r: (r) => s(r.name) },
          { h: 'Location', r: (r) => s(r.location) || '—' },
        ]}
      />
    </>
  );
}

function ScanTab() {
  const [token, setToken] = useState('');
  const [found, setFound] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  return (
    <>
      <p className="hint">
        Type or paste the code from a label (it starts with ASSET:). A phone camera app can read the
        label and open this page.
      </p>
      <div className="toolbar">
        <input
          aria-label="Label code"
          placeholder="ASSET:…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Act
          label="Find asset"
          primary
          run={async () => {
            setMsg('');
            setFound(null);
            try {
              setFound(await apost('/assets/qr/scan', { token, purpose: 'VIEW' }));
            } catch (e) {
              setMsg(e instanceof Error ? e.message : 'Not found.');
              throw e;
            }
          }}
          ok="Found"
        />
      </div>
      <ErrorBox message={msg} />
      {found ? (
        <p>
          <b>{s(found.assetNo)}</b> · {s(found.name)} · {s(found.location) || 'no location'} ·{' '}
          {s(found.status).replace('_', ' ')}
        </p>
      ) : null}
    </>
  );
}

function Verification({ actions }: { actions: ActionSet }) {
  const toast = useToast();
  const list = useLoad(() => aget<Row[]>('/assets/verifications'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="toolbar">
        {actions.add ? (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            + Start a count
          </button>
        ) : null}
      </div>
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data ?? []}
        loading={list.loading}
        empty="No counts yet. Click + Start a count."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'Count', r: (r) => s(r.pvNo) },
          { h: 'Title', r: (r) => s(r.title) },
          { h: 'Checked', r: (r) => `${s(r.checked)} of ${s(r.total)}` },
          { h: 'Missing', r: (r) => s(r.missing) },
          {
            h: 'Status',
            r: (r) => (
              <Pill tone={s(r.status) === 'OPEN' ? 'pending' : 'approved'}>{s(r.status)}</Pill>
            ),
          },
          {
            h: '',
            r: (r) => (
              <button type="button" className="btn" onClick={() => setOpen(s(r.id))}>
                Open
              </button>
            ),
          },
        ]}
      />
      {adding ? (
        <FormModal
          title="Start a physical count"
          sub="Every asset in service is listed. Tick what you find on the floor."
          fields={[
            { key: 'title', label: 'Title', required: true },
            { key: 'location', label: 'Only this location (optional)' },
          ]}
          initial={{ title: `Count ${todayIso()}` }}
          onClose={() => setAdding(false)}
          onSubmit={async (v) => {
            const r = await apost('/assets/verifications', v);
            toast('Count started');
            setAdding(false);
            list.reload();
            setOpen(s(r.id));
          }}
        />
      ) : null}
      {open ? (
        <VerifyView
          id={open}
          actions={actions}
          onClose={() => setOpen(null)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </>
  );
}

function VerifyView({
  id,
  actions,
  onClose,
  onChanged,
}: {
  id: string;
  actions: ActionSet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const doc = useLoad(() => aget(`/assets/verifications/${id}`), [id]);
  const v = doc.data;
  const after = () => {
    doc.reload();
    onChanged();
  };
  const open = s(v?.status) === 'OPEN';
  return (
    <Dialog
      title={v ? `${s(v.pvNo)} · ${s(v.title)}` : 'Count'}
      onClose={onClose}
      error={doc.error}
      footer={
        open && actions.post ? (
          <Act
            label="Close the count"
            primary
            run={() => apost(`/assets/verifications/${id}/close`)}
            done={after}
          />
        ) : null
      }
    >
      <Grid
        rows={(v?.lines as Row[]) ?? []}
        rowKey={(l) => s(l.id)}
        cols={[
          { h: 'Asset', r: (l) => `${s(l.assetNo)} · ${s(l.assetName)}` },
          { h: 'Where it should be', r: (l) => s(l.bookLocation) || '—' },
          {
            h: 'Found?',
            r: (l) => (l.found === null ? 'Not checked' : l.found === true ? 'Found' : 'Missing'),
          },
          {
            h: '',
            r: (l) =>
              open && actions.edit ? (
                <>
                  <Act
                    label="Found"
                    run={() =>
                      aput(`/assets/verifications/${id}/lines/${s(l.assetId)}`, { found: true })
                    }
                    done={after}
                  />
                  <Act
                    label="Missing"
                    run={() =>
                      aput(`/assets/verifications/${id}/lines/${s(l.assetId)}`, { found: false })
                    }
                    done={after}
                  />
                </>
              ) : null,
          },
        ]}
      />
    </Dialog>
  );
}
