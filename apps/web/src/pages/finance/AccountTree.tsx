// The "Account Tree" tab of the Chart of Accounts: groups and ledger accounts as a tree on the left (open / close a
// group, search), the picked account with its details and document buttons on the right.
import { useMemo, useState } from 'react';
import { RecordActions } from '../../components/workspace/RecordActions';
import { listAccounts, type Account } from '../../lib/financeApi';
import { useLoad } from '../../lib/useLoad';
import { ErrorBox, Pill } from './shared';
import './account-tree.css';

export function AccountTree({ reloadKey, onShow }: { reloadKey?: unknown; onShow: (code: string) => void }) {
  const load = useLoad(() => listAccounts(), [reloadKey]);
  const all = useMemo(() => load.data?.rows ?? [], [load.data]);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [pickedId, setPickedId] = useState('');
  const [q, setQ] = useState('');

  const children = useMemo(() => {
    const ids = new Set(all.map((a) => a.id));
    const m = new Map<string, Account[]>();
    for (const a of all) {
      const parent = a.parentId && ids.has(a.parentId) ? a.parentId : '';
      m.set(parent, [...(m.get(parent) ?? []), a]);
    }
    for (const list of m.values()) list.sort((x, y) => x.code.localeCompare(y.code));
    return m;
  }, [all]);
  // a search keeps the matching accounts and the groups above them
  const keep = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const byId = new Map(all.map((a) => [a.id, a]));
    const out = new Set<string>();
    for (const a of all) {
      if (!`${a.code} ${a.name}`.toLowerCase().includes(needle)) continue;
      let cur: Account | undefined = a;
      while (cur && !out.has(cur.id)) {
        out.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return out;
  }, [all, q]);

  const picked = all.find((a) => a.id === pickedId) ?? children.get('')?.[0];
  const toggle = (id: string): void =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const branch = (parent: string, depth: number) => {
    const list = (children.get(parent) ?? []).filter((a) => !keep || keep.has(a.id));
    if (list.length === 0) return null;
    return (
      <ul className="coa-branch" role={depth === 0 ? 'tree' : 'group'}>
        {list.map((a) => {
          const open = keep ? true : !closed.has(a.id);
          return (
            <li key={a.id} role="treeitem" aria-expanded={a.isGroup ? open : undefined} aria-selected={picked?.id === a.id}>
              <div className="coa-node" style={{ paddingLeft: 4 + depth * 16 }}>
                {a.isGroup ? (
                  <button type="button" className="coa-toggle" aria-label={`${open ? 'Close' : 'Open'} ${a.name}`} onClick={() => toggle(a.id)}>
                    {open ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="coa-leaf" aria-hidden="true">
                    •
                  </span>
                )}
                <button type="button" className={`coa-name${a.isGroup ? ' group' : ''}${picked?.id === a.id ? ' on' : ''}`} onClick={() => setPickedId(a.id)}>
                  <span className="coa-code">{a.code}</span> {a.name}
                </button>
              </div>
              {a.isGroup && open ? branch(a.id, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const parent = picked?.parentId ? all.find((a) => a.id === picked.parentId) : undefined;
  return (
    <div className="coa-split">
      <section className="coa-panel" aria-label="Account tree">
        <div className="coa-panel-head">
          <h3>Account Tree</h3>
          <input type="search" aria-label="Find an account in the tree" placeholder="Find code or name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn sm" disabled={closed.size === 0} title={closed.size === 0 ? 'Every group is already open.' : undefined} onClick={() => setClosed(new Set())}>
            Open all
          </button>
          <button type="button" className="btn sm" onClick={() => setClosed(new Set(all.filter((a) => a.isGroup && a.parentId).map((a) => a.id)))}>
            Close all
          </button>
        </div>
        <ErrorBox message={load.error} />
        {load.loading && all.length === 0 ? <p role="status">Loading…</p> : null}
        <div className="coa-scroll">{branch('', 0)}</div>
        {keep && keep.size === 0 ? <p className="muted">No account matches “{q}”.</p> : null}
      </section>
      <section className="coa-panel" aria-label="Selected account">
        <div className="coa-panel-head">
          <h3>Selected account</h3>
        </div>
        {picked ? (
          <>
            <div className="drawer-grid coa-cards">
              {([
                ['Account code', picked.code],
                ['Account name', picked.name],
                ['Account type', picked.rootType],
                ['Parent group', parent ? `${parent.code} · ${parent.name}` : 'Top level'],
                ['Kind', picked.isGroup ? 'Group' : 'Ledger account'],
                ['Cost center required', picked.costCenterRequired ? 'Yes' : 'No'],
              ] as [string, string][]).map(([label, value]) => (
                <div className="v8-mini" key={label}>
                  <small>{label}</small>
                  <b>{value}</b>
                </div>
              ))}
              <div className="v8-mini">
                <small>Status</small>
                <b>
                  <Pill>{picked.status}</Pill>
                </b>
              </div>
            </div>
            <RecordActions docType="fin-coa" id={picked.id} number={picked.code} status={picked.status}>
              <button type="button" className="btn sm" onClick={() => onShow(picked.code)}>
                Show in table
              </button>
            </RecordActions>
          </>
        ) : (
          <p className="muted">Pick an account in the tree.</p>
        )}
      </section>
    </div>
  );
}
