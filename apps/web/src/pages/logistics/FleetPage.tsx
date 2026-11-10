// apps/web/src/pages/logistics/FleetPage.tsx
import { useEffect, useState } from 'react';
import { logisticsApi } from '../../lib/logisticsApi';

const Truck = ({ className = '' }: { className?: string }) => <span className={className}>🚛</span>;
const Users = ({ className = '' }: { className?: string }) => <span className={className}>🪪</span>;
const Fuel = ({ className = '' }: { className?: string }) => <span className={className}>⛽</span>;
const Wrench = ({ className = '' }: { className?: string }) => <span className={className}>🔧</span>;
const FileText = ({ className = '' }: { className?: string }) => <span className={className}>📄</span>;
const Plus = ({ className = '' }: { className?: string }) => <span className={className}>+</span>;
const AlertTriangle = ({ className = '' }: { className?: string }) => <span className={className}>⚠️</span>;
const CheckCircle2 = ({ className = '' }: { className?: string }) => <span className={className}>✅</span>;

export function FleetPage({ initialTab }: { initialTab?: 'VEHICLES' | 'DRIVERS' | 'FUEL' | 'SERVICE' }) {
  const [tab, setTab] = useState<'VEHICLES' | 'DRIVERS' | 'FUEL' | 'SERVICE'>(initialTab ?? 'VEHICLES');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forms
  const [showVehModal, setShowVehModal] = useState(false);
  const [vehForm, setVehForm] = useState({
    regNo: '',
    vehicleType: '32FT MXL',
    ownership: 'OWN',
    isTransport: true,
    makeModel: '',
    tankCapacityL: 220,
    stdKmpl: 4.5,
  });

  const [showFuelModal, setShowFuelModal] = useState(false);
  const [fuelForm, setFuelForm] = useState({
    vehicleId: '',
    odometer: 0,
    litres: 0,
    rate: 94.5,
    isFullTank: true,
  });

  const loadAll = async () => {
    try {
      const [v, d, f, s] = await Promise.all([
        logisticsApi.listVehicles(),
        logisticsApi.listDrivers(),
        logisticsApi.listFuelLogs(),
        logisticsApi.listServices(),
      ]);
      setVehicles(v);
      setDrivers(d);
      setFuelLogs(f);
      setServices(s);
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleCreateVehicle = async () => {
    setErrorMsg(null);
    try {
      await logisticsApi.createVehicle(vehForm);
      setShowVehModal(false);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not create vehicle.');
    }
  };

  const handleCreateFuel = async () => {
    setErrorMsg(null);
    try {
      await logisticsApi.createFuelLog(fuelForm);
      setShowFuelModal(false);
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Fuel entry blocked.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-600" />
            Fleet Management
          </h1>
          <p className="text-sm text-slate-500">
            Own & leased fleet, CMVR statutory documents, drivers, full-tank fuel logs & R&M
          </p>
        </div>
        <div className="flex gap-2">
          {([
            ['VEHICLES', 'Vehicles & Docs', Truck],
            ['DRIVERS', 'Drivers', Users],
            ['FUEL', 'Fuel Logs', Fuel],
            ['SERVICE', 'Services & R&M', Wrench],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-1.5 ${
                tab === key
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          {errorMsg}
        </div>
      )}

      {tab === 'VEHICLES' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowVehModal(true)}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium flex items-center gap-1.5 hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" /> Add Vehicle
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles.map((v) => {
              const docs: any[] = Array.isArray(v.documents) ? v.documents : [];
              return (
                <div key={v.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-mono font-bold text-slate-900">{v.regNo}</div>
                      <div className="text-xs text-slate-500">{v.vehicleType} • {v.makeModel || 'Standard'} ({v.ownership})</div>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-100 text-emerald-700">
                      {v.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs bg-slate-50 p-2 rounded-lg">
                    <div>
                      <div className="text-slate-500">Odometer</div>
                      <div className="font-mono font-semibold">{Number(v.currentOdometer).toLocaleString()} km</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Tank</div>
                      <div className="font-mono font-semibold">{v.tankCapacityL} L</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Std km/l</div>
                      <div className="font-mono font-semibold">{v.stdKmpl}</div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-slate-600 flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" /> CMVR Statutory Chips
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {docs.length === 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">No documents uploaded</span>
                      ) : (
                        docs.map((doc) => (
                          <span
                            key={doc.id}
                            className={`text-xs px-2 py-0.5 rounded font-semibold ${
                              doc.status === 'VALID'
                                ? 'bg-emerald-100 text-emerald-800'
                                : doc.status === 'EXPIRING'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {doc.docTypeCode}: {String(doc.expiryDate).slice(0, 10)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'DRIVERS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Mobile</th>
                <th className="px-4 py-3 text-left">Licence No</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">Expiry</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((d) => {
                const exp = String(d.licenceExpiry).slice(0, 10);
                const expired = exp < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{d.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{d.mobile}</td>
                    <td className="px-4 py-3 font-mono">{d.licenceNo}</td>
                    <td className="px-4 py-3 text-xs">{d.licenceClass}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${expired ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {exp} {expired ? '(EXPIRED)' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{d.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'FUEL' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => {
                setFuelForm({ ...fuelForm, vehicleId: vehicles[0]?.id || '' });
                setShowFuelModal(true);
              }}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium flex items-center gap-1.5 hover:bg-indigo-700"
            >
              <Plus className="w-4 h-4" /> Log Fuel Fill
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Fuel No</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-right">Odometer</th>
                  <th className="px-4 py-3 text-right">Litres</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">km/l (Var%)</th>
                  <th className="px-4 py-3 text-left">Anomalies</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fuelLogs.map((f) => {
                  const anomalies: string[] = Array.isArray(f.anomalyCodes) ? f.anomalyCodes : [];
                  return (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-semibold">{f.fuelNo}</td>
                      <td className="px-4 py-3 font-mono">{f.regNo}</td>
                      <td className="px-4 py-3 text-right font-mono">{Number(f.odometer).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono">{f.litres} L {f.isFullTank ? '(Full)' : ''}</td>
                      <td className="px-4 py-3 text-right font-mono">₹{Number(f.amount).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {f.kmpl ? `${f.kmpl} (${f.variancePct}%)` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {anomalies.map((a) => (
                          <span key={a} className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold">
                            {a}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {f.status === 'DRAFT' ? (
                          <button
                            onClick={async () => {
                              await logisticsApi.postFuelLog(f.id);
                              await loadAll();
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                          >
                            Post GL
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {f.status}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'SERVICE' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Service No</th>
                <th className="px-4 py-3 text-left">Vehicle</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold">{s.serviceNo}</td>
                  <td className="px-4 py-3 font-mono">{s.regNo}</td>
                  <td className="px-4 py-3">{s.serviceType}</td>
                  <td className="px-4 py-3 text-right font-mono">₹{Number(s.totalAmount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-xs">{s.status}</td>
                  <td className="px-4 py-3 text-right">
                    {s.status !== 'POSTED' && (
                      <button
                        onClick={async () => {
                          await logisticsApi.postService(s.id);
                          await loadAll();
                        }}
                        className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                      >
                        Post R&M
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showVehModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-bold text-slate-900">Add Vehicle</h3>
            <div className="space-y-3 text-sm">
              <input
                value={vehForm.regNo}
                onChange={(e) => setVehForm({ ...vehForm, regNo: e.target.value.toUpperCase() })}
                placeholder="Reg No (e.g. MH12AB1234)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase"
              />
              <input
                value={vehForm.vehicleType}
                onChange={(e) => setVehForm({ ...vehForm, vehicleType: e.target.value })}
                placeholder="Vehicle Type (e.g. 32FT MXL)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={vehForm.tankCapacityL}
                  onChange={(e) => setVehForm({ ...vehForm, tankCapacityL: Number(e.target.value) })}
                  placeholder="Tank Capacity (L)"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="number"
                  step="0.1"
                  value={vehForm.stdKmpl}
                  onChange={(e) => setVehForm({ ...vehForm, stdKmpl: Number(e.target.value) })}
                  placeholder="Std km/l"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowVehModal(false)} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
              <button onClick={handleCreateVehicle} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {showFuelModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-bold text-slate-900">Log Fuel Fill</h3>
            <div className="space-y-3 text-sm">
              <select
                value={fuelForm.vehicleId}
                onChange={(e) => setFuelForm({ ...fuelForm, vehicleId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.regNo}</option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  value={fuelForm.odometer}
                  onChange={(e) => setFuelForm({ ...fuelForm, odometer: Number(e.target.value) })}
                  placeholder="Odometer"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="number"
                  value={fuelForm.litres}
                  onChange={(e) => setFuelForm({ ...fuelForm, litres: Number(e.target.value) })}
                  placeholder="Litres"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="number"
                  value={fuelForm.rate}
                  onChange={(e) => setFuelForm({ ...fuelForm, rate: Number(e.target.value) })}
                  placeholder="Rate"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={fuelForm.isFullTank}
                  onChange={(e) => setFuelForm({ ...fuelForm, isFullTank: e.target.checked })}
                />
                Full Tank Fill (enables km/l computation)
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowFuelModal(false)} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
              <button onClick={handleCreateFuel} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">Log Fill</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
