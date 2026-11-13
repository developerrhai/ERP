// Phase 24: KPI Targets and KPI Alerts - simple registers with an add form; no number is invented, an empty list says so.
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { dashApi } from '../../lib/dashApi';
import { useLoad } from '../../lib/useLoad';
import { usePlants } from '../../lib/plants';
import type { ActionSet } from '../../types';

interface KpiOption {
  code: string;
  name: string;
}

function useKpiOptions(): KpiOption[] {
  const w = useLoad(() => api<{ code: string; title: string; kpi_code: string | null }[]>('/dashboards/widgets'), []);
  return (w.data ?? []).filter((x) => x.kpi_code).map((x) => ({ code: x.kpi_code as string, name: x.title }));
}

export function KpiTargetsPage({ actions }: { actions: ActionSet }) {
  const list = useLoad(() => dashApi.targets(), []);
  const kpis = useKpiOptions();
  const plants = usePlants().data?.allowed ?? [];
  const toast = useToast();
  const [kpi, setKpi] = useState('');
  const [unit, setUnit] = useState('');
  const [kind, setKind] = useState('MONTH');
  const [target, setTarget] = useState('');
  const [amber, setAmber] = useState('90');
  const [red, setRed] = useState('75');
  const [err, setErr] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await dashApi.saveTarget({
        kpiCode: kpi,
        unitId: unit || null,
        periodKind: kind,
        target: Number(target),
        amberPct: Number(amber),
        redPct: Number(red),
      });
      toast('Target saved.');
      setTarget('');
      list.reload();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save the target.');
    }
  }

  return (
    <div className="dash-page">
      <div className="page-head">
        <h1>KPI Targets</h1>
      </div>
      <p className="muted">Green at or above {amber}% of target, amber at or above {red}%, otherwise red.</p>
      {actions.add ? (
        <form className="inline-form" onSubmit={(e) => void save(e)}>
          <label>
            KPI
            <select value={kpi} onChange={(e) => setKpi(e.target.value)} required>
              <option value="">Choose a KPI</option>
              {kpis.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plant
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">All plants</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {['DAY', 'WEEK', 'MONTH', 'QUARTER', 'FY'].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target
            <input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} required />
          </label>
          <label>
            Amber %
            <input type="number" min="1" max="100" value={amber} onChange={(e) => setAmber(e.target.value)} />
          </label>
          <label>
            Red %
            <input type="number" min="1" max="100" value={red} onChange={(e) => setRed(e.target.value)} />
          </label>
          <button type="submit" className="btn primary">
            ＋ Add
          </button>
          {err ? <span role="alert" className="error-text">{err}</span> : null}
        </form>
      ) : null}
      {list.error ? <p role="alert">{list.error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>KPI</th>
              <th>Plant</th>
              <th>Period</th>
              <th>Target</th>
              <th>Amber / Red</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.kpi_name}</td>
                <td>{t.unit_code ?? 'All plants'}</td>
                <td>
                  {t.period_kind} from {t.period_start}
                </td>
                <td>{t.target}</td>
                <td>
                  {t.amber_pct}% / {t.red_pct}%
                </td>
                <td>
                  {actions.delete ? (
                    <button type="button" className="btn" onClick={() => void dashApi.deleteTarget(t.id).then(() => list.reload())}>
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {list.data && list.data.length === 0 ? (
              <tr>
                <td colSpan={6}>No targets yet. Press ＋ Add to create the first one.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function KpiAlertsPage({ actions }: { actions: ActionSet }) {
  const list = useLoad(() => dashApi.alerts(), []);
  const kpis = useKpiOptions();
  const plants = usePlants().data?.allowed ?? [];
  const toast = useToast();
  const [kpi, setKpi] = useState('');
  const [unit, setUnit] = useState('');
  const [cond, setCond] = useState<'GT' | 'LT' | 'BELOW_TARGET' | 'ABOVE_TARGET'>('GT');
  const [limit, setLimit] = useState('');
  const [hours, setHours] = useState('24');
  const [err, setErr] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      // recipients default to the person creating the rule; role / user pickers arrive with the admin builder (Phase 31)
      await dashApi.saveAlert({
        kpiCode: kpi,
        unitId: unit || null,
        condition: cond,
        threshold: cond === 'GT' || cond === 'LT' ? Number(limit) : null,
        recipientUserIds: [await meId()],
        channels: ['in_app'],
        cooldownHours: Number(hours),
      });
      toast('Alert rule saved.');
      list.reload();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Could not save the alert rule.');
    }
  }

  return (
    <div className="dash-page">
      <div className="page-head">
        <h1>KPI Alerts</h1>
      </div>
      <p className="muted">When a KPI crosses a limit, the people on the rule are notified, at most once per cooldown.</p>
      {actions.add ? (
        <form className="inline-form" onSubmit={(e) => void save(e)}>
          <label>
            KPI
            <select value={kpi} onChange={(e) => setKpi(e.target.value)} required>
              <option value="">Choose a KPI</option>
              {kpis.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plant
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Every plant</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            When
            <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)}>
              <option value="GT">goes above a limit</option>
              <option value="LT">falls below a limit</option>
              <option value="BELOW_TARGET">is below target</option>
              <option value="ABOVE_TARGET">is above target</option>
            </select>
          </label>
          {cond === 'GT' || cond === 'LT' ? (
            <label>
              Limit
              <input type="number" step="any" value={limit} onChange={(e) => setLimit(e.target.value)} required />
            </label>
          ) : null}
          <label>
            Cooldown (hours)
            <input type="number" min="1" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <button type="submit" className="btn primary">
            ＋ Add
          </button>
          {err ? <span role="alert" className="error-text">{err}</span> : null}
        </form>
      ) : null}
      {list.error ? <p role="alert">{list.error}</p> : null}
      <div className="table-wrap">
        <table className="register-table">
          <thead>
            <tr>
              <th>KPI</th>
              <th>Plant</th>
              <th>Rule</th>
              <th>Last raised</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.kpi_name}</td>
                <td>{r.unit_code ?? 'Every plant'}</td>
                <td>
                  {r.condition === 'GT'
                    ? `above ${r.threshold}`
                    : r.condition === 'LT'
                      ? `below ${r.threshold}`
                      : r.condition === 'BELOW_TARGET'
                        ? 'below target'
                        : 'above target'}{' '}
                  · every {r.cooldown_hours} h at most
                </td>
                <td>{r.last_raised_at ? new Date(r.last_raised_at).toLocaleString('en-IN') : '—'}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.active}
                    disabled={!actions.edit}
                    aria-label={`Rule for ${r.kpi_name} is active`}
                    onChange={(e) => void dashApi.toggleAlert(r.id, e.target.checked).then(() => list.reload())}
                  />
                </td>
                <td>
                  {actions.delete ? (
                    <button type="button" className="btn" onClick={() => void dashApi.deleteAlert(r.id).then(() => list.reload())}>
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {list.data && list.data.length === 0 ? (
              <tr>
                <td colSpan={6}>No alert rules yet. Press ＋ Add to create the first one.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function meId(): Promise<string> {
  const me = await api<{ id: string }>('/auth/me');
  return me.id;
}
