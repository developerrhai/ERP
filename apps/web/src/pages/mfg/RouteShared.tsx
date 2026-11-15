// Shared pieces of the four plant-flow pages: the plant strip (our plants by name, jobs and WIP from the database),
// the link tabs between the pages, and a button that always says why it is disabled.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { routingApi } from '../../lib/routingApi';
import type { PlantCard } from '../../lib/routingApi';
import './routing.css';

export const FLOW_TABS: { label: string; to: string }[] = [
  { label: 'BOM & Material Approval', to: '/m/flow-bom-approval' },
  { label: 'Live Routing', to: '/m/mfg-unit-route' },
  { label: 'WIP by Plant', to: '/m/mfg-unit-route?view=wip' },
  { label: 'Transfer Receipt', to: '/m/mfg-transfer-note' },
  { label: 'Quality Release', to: '/m/mfg-unit-route?view=quality' },
  { label: 'Dispatch Readiness', to: '/m/mfg-unit-route?view=dispatch' },
];

export function FlowTabs({ current }: { current: string }): ReactNode {
  return (
    <div className="card rt-tabs" role="navigation" aria-label="Plant flow">
      {FLOW_TABS.map((t) => (
        <Link key={t.label} className={`btn${t.label === current ? ' primary' : ''}`} to={t.to} aria-current={t.label === current ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function PlantStrip(): ReactNode {
  const [plants, setPlants] = useState<PlantCard[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    routingApi.plants().then(setPlants, () => setError('Could not load the plants.'));
  }, []);
  if (error) return <p role="alert">{error}</p>;
  return (
    <div className="card rt-plants">
      {plants.map((p, i) => (
        <div key={p.id} className="rt-plant">
          <b>{`Plant / Unit ${i + 1}`}</b>
          <div>{p.name}</div>
          <div className="muted">{p.processes.length > 0 ? p.processes.join(' -> ') : 'No route step in this plant yet'}</div>
          <div className="rt-num">{`${p.jobs} jobs`}</div>
          <div className="muted">{`WIP balance: ${p.wipBalance}`}</div>
        </div>
      ))}
    </div>
  );
}

/** A button that is never disabled without saying why (tooltip and text for screen readers). */
export function ReasonButton(props: { label: string; reason: string | null; onClick: () => void; primary?: boolean; danger?: boolean }): ReactNode {
  const { label, reason, onClick, primary, danger } = props;
  return (
    <button type="button" className={`btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}`} disabled={reason !== null} title={reason ?? undefined} aria-label={reason ? `${label} (unavailable: ${reason})` : label} onClick={onClick}>
      {label}
    </button>
  );
}

export const dash = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? '-' : v);
