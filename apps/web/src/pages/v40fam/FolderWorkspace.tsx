// Document Management > Folders 2-column workspace (QA report DOC-02):
// left = interactive expandable Folder Tree, right = Selected Node editor (Code, Name, Effective From, Owner, Dependency, Status)
// with a blue Update Node button. Choosing a node in the tree loads it into the editor; Update Node writes it back.
import { useState } from 'react';
import { useToast } from '../../components/Toast';

interface Node {
  code: string;
  name: string;
  effectiveFrom: string;
  owner: string;
  dependency: string;
  status: string;
  children?: Node[];
}

const STATUS = ['Active', 'Draft', 'Under Review', 'Archived'];
const OWNERS = ['Engineering Head', 'Quality Head', 'Finance Controller', 'Logistics Manager', 'HR Manager', 'Document Controller'];

const INITIAL: Node = {
  code: 'FLD-ROOT',
  name: 'Folders',
  effectiveFrom: '2026-04-01',
  owner: 'Document Controller',
  dependency: 'None',
  status: 'Active',
  children: [
    {
      code: 'FLD-ENG',
      name: 'Parent: Engineering & Drawings',
      effectiveFrom: '2026-04-01',
      owner: 'Engineering Head',
      dependency: 'FLD-ROOT',
      status: 'Active',
      children: [
        { code: 'FLD-ENG-1.1', name: 'Child 1.1: CAD Models', effectiveFrom: '2026-04-15', owner: 'Engineering Head', dependency: 'FLD-ENG', status: 'Active' },
        { code: 'FLD-ENG-1.2', name: 'Child 1.2: Specifications', effectiveFrom: '2026-05-02', owner: 'Engineering Head', dependency: 'FLD-ENG', status: 'Active' },
        { code: 'FLD-DEP-1', name: 'Dependency 1: Customer Drawings', effectiveFrom: '2026-06-10', owner: 'Quality Head', dependency: 'FLD-ENG-1.1', status: 'Under Review' },
      ],
    },
    {
      code: 'FLD-QUA',
      name: 'Parent: Quality / PPAP / SOPs',
      effectiveFrom: '2026-04-01',
      owner: 'Quality Head',
      dependency: 'FLD-ROOT',
      status: 'Active',
      children: [{ code: 'FLD-QUA-2.1', name: 'Child 2.1: Certificates', effectiveFrom: '2026-07-01', owner: 'Quality Head', dependency: 'FLD-QUA', status: 'Active' }],
    },
    {
      code: 'FLD-FIN',
      name: 'Parent: Finance & Statutory',
      effectiveFrom: '2026-04-01',
      owner: 'Finance Controller',
      dependency: 'FLD-ROOT',
      status: 'Active',
      children: [{ code: 'FLD-FIN-3.1', name: 'Child 3.1: GST Returns', effectiveFrom: '2026-04-20', owner: 'Finance Controller', dependency: 'FLD-FIN', status: 'Active' }],
    },
  ],
};

function flatten(n: Node): Node[] {
  return [n, ...(n.children ?? []).flatMap(flatten)];
}

function replace(n: Node, code: string, next: Node): Node {
  if (n.code === code) return { ...next, ...(n.children ? { children: n.children } : {}) };
  return n.children ? { ...n, children: n.children.map((c) => replace(c, code, next)) } : n;
}

export function FolderWorkspace() {
  const toast = useToast();
  const [root, setRoot] = useState<Node>(INITIAL);
  const [open, setOpen] = useState<Set<string>>(new Set(['FLD-ROOT', 'FLD-ENG']));
  const [selected, setSelected] = useState('FLD-ENG');
  const current = flatten(root).find((n) => n.code === selected) ?? root;
  const [draft, setDraft] = useState<Node>(current);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pick = (n: Node): void => {
    setSelected(n.code);
    setDraft(n);
    setErrors({});
  };
  const toggle = (code: string): void =>
    setOpen((p) => {
      const nx = new Set(p);
      if (nx.has(code)) nx.delete(code);
      else nx.add(code);
      return nx;
    });

  const update = (): void => {
    const e: Record<string, string> = {};
    if (!draft.code.trim()) e.code = 'Code is required.';
    if (!draft.name.trim()) e.name = 'Name is required.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) e.effectiveFrom = 'Pick a date.';
    if (!draft.owner) e.owner = 'Choose the owner.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setRoot((r) => replace(r, selected, draft));
    setSelected(draft.code);
    toast(`Node ${draft.code} updated.`);
  };

  const field = (key: keyof Node, label: string, kind: 'text' | 'date' | 'select' | 'owner' | 'status') => {
    const bad = errors[key];
    const style = { padding: '7px 10px', borderRadius: 6, border: `1px solid ${bad ? '#dc2626' : '#cbd5e1'}`, background: bad ? '#fef2f2' : '#fff', fontSize: 13, width: '100%' } as const;
    const value = String(draft[key] ?? '');
    const set = (v: string): void => setDraft((d) => ({ ...d, [key]: v }));
    return (
      <label key={key} style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 600 }}>
        {label}
        {kind === 'date' ? (
          <input type="date" value={value} style={style} onChange={(e) => set(e.target.value)} />
        ) : kind === 'owner' ? (
          <select value={value} style={style} onChange={(e) => set(e.target.value)}>
            {OWNERS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : kind === 'status' ? (
          <select value={value} style={style} onChange={(e) => set(e.target.value)}>
            {STATUS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : kind === 'select' ? (
          <select value={value} style={style} onChange={(e) => set(e.target.value)}>
            <option>None</option>
            {flatten(root)
              .filter((n) => n.code !== draft.code)
              .map((n) => (
                <option key={n.code}>{n.code}</option>
              ))}
          </select>
        ) : (
          <input type="text" value={value} style={style} onChange={(e) => set(e.target.value)} />
        )}
        {bad ? <span role="alert" style={{ color: '#dc2626', fontSize: 11 }}>{bad}</span> : null}
      </label>
    );
  };

  const render = (n: Node, depth: number) => {
    const kids = n.children ?? [];
    const isOpen = open.has(n.code);
    const active = n.code === selected;
    return (
      <div key={n.code}>
        <div
          role="treeitem"
          aria-selected={active}
          tabIndex={0}
          onClick={() => pick(n)}
          onKeyDown={(e) => e.key === 'Enter' && pick(n)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginLeft: depth * 18, borderRadius: 6, cursor: 'pointer', fontSize: 13, background: active ? '#eff6ff' : 'transparent', border: active ? '1px solid #3b82f6' : '1px solid transparent' }}
        >
          {kids.length ? (
            <button
              type="button"
              aria-label={isOpen ? `Collapse ${n.name}` : `Expand ${n.name}`}
              className="btn sm"
              style={{ padding: '0 6px' }}
              onClick={(e) => {
                e.stopPropagation();
                toggle(n.code);
              }}
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span style={{ width: 26 }} />
          )}
          <span>{kids.length ? '📂' : '📄'}</span>
          <span style={{ fontWeight: active ? 700 : 500 }}>{n.name}</span>
          <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>{n.code}</span>
        </div>
        {isOpen ? kids.map((c) => render(c, depth + 1)) : null}
      </div>
    );
  };

  return (
    <>
      <div className="v9-section" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: 14 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Folder Tree</h3>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>Folders → Parent → Child → Dependency. Click a node to edit it.</div>
        <div role="tree" aria-label="Folder tree">
          {render(root, 0)}
        </div>
      </div>
      <div className="v9-section" style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: 14 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Selected Node</h3>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>Editing {current.code}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {field('code', 'Code', 'text')}
          {field('name', 'Name', 'text')}
          {field('effectiveFrom', 'Effective From', 'date')}
          {field('owner', 'Owner', 'owner')}
          {field('dependency', 'Dependency', 'select')}
          {field('status', 'Status', 'status')}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn primary" onClick={update}>
            Update Node
          </button>
        </div>
      </div>
    </>
  );
}
