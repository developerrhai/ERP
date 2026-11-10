// apps/web/src/pages/logistics/LogisticsPage.tsx
import { useEffect, useState } from 'react';
import { logisticsApi } from '../../lib/logisticsApi';

const Package = ({ className = '' }: { className?: string }) => <span className={className}>📦</span>;
const MapPin = ({ className = '' }: { className?: string }) => <span className={className}>📍</span>;
const Calculator = ({ className = '' }: { className?: string }) => <span className={className}>🧮</span>;
const Box = ({ className = '' }: { className?: string }) => <span className={className}>🚢</span>;
const ClipboardCheck = ({ className = '' }: { className?: string }) => <span className={className}>📋</span>;
const Truck = ({ className = '' }: { className?: string }) => <span className={className}>🚛</span>;
const X = ({ className = '' }: { className?: string }) => <span className={className}>✕</span>;
const Plus = ({ className = '' }: { className?: string }) => <span className={className}>+</span>;

const SHIPMENT_STAGES = ['PLANNED', 'LOADING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'POD_RECEIVED'] as const;

export function LogisticsPage({
  initialTab,
}: {
  initialTab?: 'SHIPMENTS' | 'FREIGHT' | 'ROUTES' | 'TRANSPORTERS' | 'POD' | 'CONTAINERS';
}) {
  const [tab, setTab] = useState<'SHIPMENTS' | 'FREIGHT' | 'ROUTES' | 'TRANSPORTERS' | 'POD' | 'CONTAINERS'>(
    initialTab ?? 'SHIPMENTS',
  );
  const [shipments, setShipments] = useState<any[]>([]);
  const [rateCards, setRateCards] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [transporters, setTransporters] = useState<any[]>([]);
  const [pods, setPods] = useState<any[]>([]);
  const [containers, setContainers] = useState<any[]>([]);
  const [activeShipment, setActiveShipment] = useState<any | null>(null);
  const [trackingEvents, setTrackingEvents] = useState<any[]>([]);

  // Freight Calculator state
  const [calcInput, setCalcInput] = useState({
    rateCardId: '',
    weightKg: 2350,
    distanceKm: 410,
    tollAmount: 1450,
    loadingAmount: 500,
    gtaRcmApplicable: true,
    save: false,
  });
  const [calcResult, setCalcResult] = useState<any | null>(null);
  const [containerNo, setContainerNo] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [s, rc, r, t, p, c] = await Promise.all([
        logisticsApi.listShipments(),
        logisticsApi.listRateCards(),
        logisticsApi.listRoutes(),
        logisticsApi.listTransporters(),
        logisticsApi.listPods(),
        logisticsApi.listContainers(),
      ]);
      setShipments(s);
      setRateCards(rc);
      setRoutes(r);
      setTransporters(t);
      setPods(p);
      setContainers(c);
      if (rc[0] && !calcInput.rateCardId) {
        setCalcInput((prev) => ({ ...prev, rateCardId: rc[0].id }));
      }
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const openTrackingDrawer = async (shp: any) => {
    setActiveShipment(shp);
    const ev = await logisticsApi.listTrackingEvents(shp.id);
    setTrackingEvents(ev);
  };

  const handleCalculateFreight = async () => {
    setErrorMsg(null);
    if (!calcInput.rateCardId) {
      setErrorMsg('Create & approve a freight rate card first.');
      return;
    }
    try {
      const res = await logisticsApi.calculateFreight(calcInput);
      setCalcResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Freight calculation error');
    }
  };

  const handleAddContainer = async () => {
    setErrorMsg(null);
    try {
      await logisticsApi.createContainer({ containerNo, containerType: '20GP', freeDays: 7 });
      setContainerNo('');
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid container number');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-indigo-600" />
            Logistics & Freight Control
          </h1>
          <p className="text-sm text-slate-500">
            Shipments Kanban, live tracking, freight rate cards & GTA RCM calculator, PODs & ISO 6346 containers
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['SHIPMENTS', 'Shipments Kanban', Package],
            ['FREIGHT', 'Freight & Cards', Calculator],
            ['ROUTES', 'Routes', MapPin],
            ['TRANSPORTERS', 'Transporters', Truck],
            ['POD', 'Proof of Delivery', ClipboardCheck],
            ['CONTAINERS', 'Containers', Box],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center gap-1.5 ${
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
        <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-2.5 rounded-lg text-sm">{errorMsg}</div>
      )}

      {tab === 'SHIPMENTS' && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {SHIPMENT_STAGES.map((stage) => {
            const list = shipments.filter((s) => s.status === stage);
            return (
              <div key={stage} className="bg-slate-100 rounded-xl p-3 space-y-2 min-h-[260px]">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase">
                  <span>{stage.replace('_', ' ')}</span>
                  <span className="px-2 py-0.5 rounded-full bg-white text-slate-600">{list.length}</span>
                </div>
                {list.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => openTrackingDrawer(s)}
                    className="bg-white rounded-lg border border-slate-200 p-3 space-y-1 cursor-pointer hover:border-indigo-400 shadow-sm"
                  >
                    <div className="font-mono font-bold text-xs text-indigo-700">{s.shipmentNo}</div>
                    <div className="text-xs font-medium text-slate-800 truncate">{s.customerName || 'Customer'}</div>
                    <div className="text-[11px] text-slate-500">
                      {s.vehicleRegNo || s.hiredVehicleNo || 'Unassigned'} • {s.weightKg} kg
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'FREIGHT' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-indigo-600" /> Freight Rate Calculator
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Rate Card</label>
                <select
                  value={calcInput.rateCardId}
                  onChange={(e) => setCalcInput({ ...calcInput, rateCardId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {rateCards.map((rc) => (
                    <option key={rc.id} value={rc.id}>
                      {rc.code} — {rc.supplierName} ({rc.basis})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Weight (kg)</label>
                  <input
                    type="number"
                    value={calcInput.weightKg}
                    onChange={(e) => setCalcInput({ ...calcInput, weightKg: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Distance (km)</label>
                  <input
                    type="number"
                    value={calcInput.distanceKm}
                    onChange={(e) => setCalcInput({ ...calcInput, distanceKm: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Toll (₹)</label>
                  <input
                    type="number"
                    value={calcInput.tollAmount}
                    onChange={(e) => setCalcInput({ ...calcInput, tollAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Loading (₹)</label>
                  <input
                    type="number"
                    value={calcInput.loadingAmount}
                    onChange={(e) => setCalcInput({ ...calcInput, loadingAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <button
                onClick={handleCalculateFreight}
                className="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
              >
                Calculate Freight
              </button>
            </div>

            {calcResult && (
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-1 text-sm">
                <div className="flex justify-between"><span>Base Freight:</span><span className="font-mono">₹{Number(calcResult.baseAmount ?? calcResult.base_amount).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Fuel Surcharge:</span><span className="font-mono">₹{Number(calcResult.fuelSurcharge ?? calcResult.fuel_surcharge).toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Toll + Loading:</span><span className="font-mono">₹{(Number(calcResult.tollAmount ?? calcResult.toll_amount) + Number(calcResult.loadingAmount ?? calcResult.loading_amount)).toFixed(2)}</span></div>
                <div className="flex justify-between font-bold text-base border-t pt-1 border-slate-300">
                  <span>Total Freight:</span>
                  <span className="font-mono text-indigo-700">₹{Number(calcResult.totalAmount ?? calcResult.total_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>GTA RCM 5% (Informational):</span>
                  <span className="font-mono">₹{Number(calcResult.gtaRcmAmount ?? calcResult.gta_rcm_amount).toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h2 className="font-bold text-slate-800">Approved & Draft Rate Cards</h2>
            <div className="divide-y divide-slate-100">
              {rateCards.map((rc) => (
                <div key={rc.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold">{rc.code} ({rc.basis})</div>
                    <div className="text-xs text-slate-500">{rc.supplierName} • {rc.routeName} • Min ₹{rc.minCharge}</div>
                  </div>
                  {rc.status === 'DRAFT' ? (
                    <button
                      onClick={async () => { await logisticsApi.approveRateCard(rc.id); await loadAll(); }}
                      className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs"
                    >
                      Approve
                    </button>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-semibold">{rc.status}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'ROUTES' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Route</th>
                <th className="px-4 py-3 text-left">Origin ➜ Destination</th>
                <th className="px-4 py-3 text-right">Distance</th>
                <th className="px-4 py-3 text-right">Std Transit</th>
                <th className="px-4 py-3 text-right">Toll</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {routes.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{r.code}</td>
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3">{r.originPlace} ➜ {r.destinationPlace}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.distanceKm} km</td>
                  <td className="px-4 py-3 text-right font-mono">{r.stdTransitHrs} hrs</td>
                  <td className="px-4 py-3 text-right font-mono">₹{r.tollCost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'TRANSPORTERS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Transporter</th>
                <th className="px-4 py-3 text-left">GSTIN / TRANSIN</th>
                <th className="px-4 py-3 text-left">GTA RCM 5%</th>
                <th className="px-4 py-3 text-left">Insurance Valid Till</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transporters.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{t.code}</td>
                  <td className="px-4 py-3">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{t.gstin || t.transin || '-'}</td>
                  <td className="px-4 py-3">{t.gtaRcm ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-xs">{t.insuranceValidTill ? String(t.insuranceValidTill).slice(0, 10) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'POD' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Shipment</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Receiver</th>
                <th className="px-4 py-3 text-left">Delivered At</th>
                <th className="px-4 py-3 text-right">Billing Hold</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pods.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{p.shipmentNo}</td>
                  <td className="px-4 py-3">{p.customerName || '-'}</td>
                  <td className="px-4 py-3">{p.receiverName} ({p.receiverMobile || '-'})</td>
                  <td className="px-4 py-3 text-xs">{String(p.deliveredAt).slice(0, 16)}</td>
                  <td className="px-4 py-3 text-right">
                    {p.billingReleased ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs font-semibold">Released</span>
                    ) : (
                      <button
                        onClick={async () => { await logisticsApi.releasePodBilling(p.id); await loadAll(); }}
                        className="px-2.5 py-1 rounded bg-indigo-600 text-white text-xs"
                      >
                        Release Billing
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'CONTAINERS' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
            <input
              value={containerNo}
              onChange={(e) => setContainerNo(e.target.value.toUpperCase())}
              placeholder="ISO 6346 Container No (e.g. CSQU3054383)"
              className="flex-1 min-w-[260px] px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase text-sm"
            />
            <button
              onClick={handleAddContainer}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Register Container
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">Container No</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-right">Free Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {containers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono font-bold text-indigo-700">{c.containerNo}</td>
                    <td className="px-4 py-3">{c.containerType}</td>
                    <td className="px-4 py-3 text-xs">{c.currentStatus}</td>
                    <td className="px-4 py-3">{c.currentLocation || 'Yard'}</td>
                    <td className="px-4 py-3 text-right">{c.freeDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tracking Drawer */}
      {activeShipment && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white border-l border-slate-200 shadow-xl p-5 flex flex-col justify-between">
          <div className="space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-slate-900 font-mono">{activeShipment.shipmentNo}</h3>
                <p className="text-xs text-slate-500">{activeShipment.customerName}</p>
              </div>
              <button onClick={() => setActiveShipment(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase text-slate-500">Append-Only Tracking Timeline</h4>
              {trackingEvents.map((ev) => (
                <div key={ev.id} className="border-l-2 border-indigo-500 pl-3 py-1 space-y-0.5">
                  <div className="text-sm font-semibold text-slate-800">{ev.milestone}</div>
                  <div className="text-xs text-slate-500">{ev.location || '-'} • {String(ev.recordedAt).slice(0, 16)}</div>
                  {ev.note && <div className="text-xs text-slate-600">{ev.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
