// apps/web/src/pages/logistics/GateKioskPage.tsx
import { useEffect, useState } from 'react';
import { logisticsApi } from '../../lib/logisticsApi';

const Truck = ({ className = '' }: { className?: string }) => <span className={className}>🚚</span>;
const ArrowDownLeft = ({ className = '' }: { className?: string }) => <span className={className}>↙️</span>;
const ArrowUpRight = ({ className = '' }: { className?: string }) => <span className={className}>↗️</span>;
const RotateCcw = ({ className = '' }: { className?: string }) => <span className={className}>↩️</span>;
const AlertTriangle = ({ className = '' }: { className?: string }) => <span className={className}>⚠️</span>;
const CheckCircle2 = ({ className = '' }: { className?: string }) => <span className={className}>✅</span>;
const Printer = ({ className = '' }: { className?: string }) => <span className={className}>🖨️</span>;
const Scale = ({ className = '' }: { className?: string }) => <span className={className}>⚖️</span>;

export function GateKioskPage({ initialMode }: { initialMode?: 'IN' | 'OUT' | 'RETURN' }) {
  const [tab, setTab] = useState<'KIOSK' | 'REGISTER' | 'OVERDUE'>('KIOSK');
  const [mode, setMode] = useState<'IN' | 'OUT' | 'RETURN'>(initialMode ?? 'IN');
  const [passes, setPasses] = useState<any[]>([]);
  const [pendingDispatch, setPendingDispatch] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);

  // Kiosk form fields (strictly no monetary values shown to guard)
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverMobile, setDriverMobile] = useState('');
  const [partyName, setPartyName] = useState('');
  const [challanRef, setChallanRef] = useState('');
  const [weighInKg, setWeighInKg] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [ewayVehicleNo, setEwayVehicleNo] = useState('');
  const [visitorNote, setVisitorNote] = useState('');

  // Selected lines for OUT / RETURN steppers
  const [selectedLines, setSelectedLines] = useState<Record<string, number>>({});
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    try {
      const [p, pd, ov] = await Promise.all([
        logisticsApi.listGatePasses(),
        logisticsApi.getPendingDispatchLines().catch(() => []),
        logisticsApi.getOverdueReturnables().catch(() => []),
      ]);
      setPasses(p);
      setPendingDispatch(pd);
      setOverdue(ov);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const recentVehicles = Array.from(new Set(passes.map((p) => String(p.vehicleNo)).filter(Boolean))).slice(0, 6);

  const adjustQty = (key: string, delta: number, maxQty: number) => {
    setSelectedLines((prev) => {
      const curr = prev[key] ?? 0;
      const next = Math.max(0, Math.min(maxQty, curr + delta));
      return { ...prev, [key]: next };
    });
  };

  const handleAllowAndPrint = async () => {
    setErrorBanner(null);
    setSuccessBanner(null);
    if (!vehicleNo.trim()) {
      setErrorBanner('Enter vehicle registration number (e.g. MH12AB1234).');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'IN') {
        const created = await logisticsApi.createGatePass({
          direction: 'IN',
          passType: 'INWARD_OTHER',
          partyName: partyName || 'Walk-in Supplier',
          vehicleNo,
          driverName,
          driverMobile,
          challanRef,
          visitorNote,
          lines: [{ description: challanRef || 'Inward Material', uom: 'NOS', qty: 1 }],
        });
        const entered = await logisticsApi.enterGatePass(
          created.id,
          weighInKg ? Number(weighInKg) : undefined,
        );
        setSuccessBanner(`Allowed IN: Gate Pass ${entered.passNo} marked INSIDE.`);
      } else if (mode === 'OUT') {
        const picked = pendingDispatch.filter((d) => (selectedLines[d.dispatchLineId] ?? 0) > 0);
        if (picked.length === 0) {
          setErrorBanner('Select at least one dispatch line using + stepper before exit.');
          setLoading(false);
          return;
        }
        const created = await logisticsApi.createGatePass({
          direction: 'OUT',
          passType: 'OUTWARD_DISPATCH',
          partyName: picked[0].customerName,
          vehicleNo,
          driverName,
          driverMobile,
          ewayBillNo: ewayBillNo || undefined,
          ewayVehicleNo: ewayVehicleNo || undefined,
          lines: picked.map((d) => ({
            itemId: d.itemId,
            description: `${d.itemCode || ''} ${d.itemName || d.dispatchNo}`.trim(),
            uom: 'NOS',
            qty: selectedLines[d.dispatchLineId],
            dispatchId: d.dispatchId,
            dispatchLineId: d.dispatchLineId,
          })),
        });
        const exited = await logisticsApi.exitGatePass(created.id);
        setSuccessBanner(`Allowed OUT & Printed: Pass ${exited.passNo} exited.`);
        window.open(`/api/v1/gate-passes/${exited.id}/print`, '_blank');
      } else if (mode === 'RETURN') {
        const picked = overdue.filter((o) => (selectedLines[o.lineId] ?? 0) > 0);
        if (picked.length === 0) {
          setErrorBanner('Select at least one returnable item using + stepper.');
          setLoading(false);
          return;
        }
        const inPass = await logisticsApi.createGatePass({
          direction: 'IN',
          passType: 'INWARD_RETURN',
          partyName: picked[0].supplierName || 'Job Work Vendor',
          vehicleNo,
          driverName,
          driverMobile,
          lines: picked.map((o) => ({
            itemId: o.itemId,
            description: o.description,
            uom: 'NOS',
            qty: selectedLines[o.lineId],
          })),
        });
        await logisticsApi.recordGateReturn(
          inPass.id,
          picked.map((o) => ({ outLineId: o.lineId, qty: selectedLines[o.lineId] })),
        );
        setSuccessBanner(`Material Return Recorded: ${inPass.passNo}`);
      }
      setSelectedLines({});
      await loadAll();
    } catch (err: any) {
      setErrorBanner(err?.message || 'Gate action blocked.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-600" />
            Gate Kiosk & Security Register
          </h1>
          <p className="text-sm text-slate-500">
            Zero-leakage physical gate control: PO-linked inward, verified dispatch outward, CGST Rule 55 challans
          </p>
        </div>
        <div className="flex gap-2">
          {(['KIOSK', 'REGISTER', 'OVERDUE'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                tab === t
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t === 'KIOSK' ? 'Tablet Kiosk' : t === 'REGISTER' ? 'Gate Register' : `Overdue Returnables (${overdue.length})`}
            </button>
          ))}
        </div>
      </div>

      {tab === 'KIOSK' && (
        <div className="space-y-4">
          {/* Top 3 Big Mode Buttons (>= 64px height) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              onClick={() => { setMode('IN'); setErrorBanner(null); setSuccessBanner(null); }}
              className={`min-h-[64px] rounded-xl flex items-center justify-center gap-3 text-lg font-bold border-2 transition ${
                mode === 'IN'
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <ArrowDownLeft className="w-6 h-6" /> Vehicle IN
            </button>
            <button
              onClick={() => { setMode('OUT'); setErrorBanner(null); setSuccessBanner(null); }}
              className={`min-h-[64px] rounded-xl flex items-center justify-center gap-3 text-lg font-bold border-2 transition ${
                mode === 'OUT'
                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <ArrowUpRight className="w-6 h-6" /> Vehicle OUT
            </button>
            <button
              onClick={() => { setMode('RETURN'); setErrorBanner(null); setSuccessBanner(null); }}
              className={`min-h-[64px] rounded-xl flex items-center justify-center gap-3 text-lg font-bold border-2 transition ${
                mode === 'RETURN'
                  ? 'bg-amber-600 text-white border-amber-700 shadow-md'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <RotateCcw className="w-6 h-6" /> Material RETURN
            </button>
          </div>

          {errorBanner && (
            <div className="bg-red-50 border-2 border-red-400 text-red-800 px-4 py-3 rounded-xl flex items-center gap-3 font-semibold">
              <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {successBanner && (
            <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-3 font-semibold">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <span>{successBanner}</span>
            </div>
          )}

          {/* Two-Column Tablet Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left Column: Vehicle & Driver Details */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-semibold text-slate-800 text-base">Vehicle & Driver</h2>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Vehicle Registration No *
                </label>
                <input
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                  placeholder="MH12AB1234"
                  className="w-full px-4 py-3 text-2xl font-mono font-bold tracking-wider uppercase border-2 border-slate-300 rounded-xl focus:border-indigo-500 focus:outline-none"
                />
                {recentVehicles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {recentVehicles.map((rv) => (
                      <button
                        key={rv}
                        type="button"
                        onClick={() => setVehicleNo(rv)}
                        className="px-2.5 py-1 text-xs font-mono bg-slate-100 hover:bg-indigo-100 text-slate-700 rounded border border-slate-200"
                      >
                        {rv}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Driver Name</label>
                  <input
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="Driver Name"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Driver Mobile</label>
                  <input
                    value={driverMobile}
                    onChange={(e) => setDriverMobile(e.target.value)}
                    placeholder="98XXXXXXXX"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {mode === 'IN' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Supplier / Party</label>
                      <input
                        value={partyName}
                        onChange={(e) => setPartyName(e.target.value)}
                        placeholder="Supplier Name"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Weigh-In (kg)</label>
                      <input
                        type="number"
                        value={weighInKg}
                        onChange={(e) => setWeighInKg(e.target.value)}
                        placeholder="0"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Challan Ref / Visitor Note</label>
                    <input
                      value={challanRef}
                      onChange={(e) => setChallanRef(e.target.value)}
                      placeholder="Supplier Challan No"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2"
                    />
                    <input
                      value={visitorNote}
                      onChange={(e) => setVisitorNote(e.target.value)}
                      placeholder="Visitor / Purpose note"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                </>
              )}

              {mode === 'OUT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">E-Way Bill No (12 digits)</label>
                    <input
                      value={ewayBillNo}
                      onChange={(e) => setEwayBillNo(e.target.value)}
                      placeholder="12-digit number"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">E-Way Part B Vehicle</label>
                    <input
                      value={ewayVehicleNo}
                      onChange={(e) => setEwayVehicleNo(e.target.value.toUpperCase())}
                      placeholder="MH12AB1234"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Cards with Qty Steppers (NO Money Shown!) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <h2 className="font-semibold text-slate-800 text-base">
                  {mode === 'IN'
                    ? 'Inward Entry Confirmation'
                    : mode === 'OUT'
                      ? 'Pending Deliveries Ready to Gate Out'
                      : 'Open Returnable Lines Pending Receipt'}
                </h2>

                {mode === 'OUT' && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {pendingDispatch.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 text-center">No posted deliveries waiting at gate.</div>
                    ) : (
                      pendingDispatch.map((d) => {
                        const pending = Number(d.dispatchedQty) - Number(d.gatedQty);
                        const qty = selectedLines[d.dispatchLineId] ?? 0;
                        return (
                          <div key={d.dispatchLineId} className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-sm text-slate-800">{d.dispatchNo} — {d.customerName}</div>
                              <div className="text-xs text-slate-500">{d.itemCode} {d.itemName} (Pending: {pending})</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => adjustQty(d.dispatchLineId, -1, pending)}
                                className="w-10 h-10 rounded-lg border border-slate-300 text-lg font-bold bg-slate-50"
                              >
                                −
                              </button>
                              <span className="w-10 text-center font-bold text-base">{qty}</span>
                              <button
                                onClick={() => adjustQty(d.dispatchLineId, 1, pending)}
                                className="w-10 h-10 rounded-lg border border-slate-300 text-lg font-bold bg-slate-50"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {mode === 'RETURN' && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {overdue.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 text-center">No open returnable material lines.</div>
                    ) : (
                      overdue.map((o) => {
                        const bal = Number(o.balanceQty);
                        const qty = selectedLines[o.lineId] ?? 0;
                        return (
                          <div key={o.lineId} className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-sm text-slate-800">{o.passNo} — {o.supplierName}</div>
                              <div className="text-xs text-slate-500">{o.description} (Balance: {bal})</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => adjustQty(o.lineId, -1, bal)}
                                className="w-10 h-10 rounded-lg border border-slate-300 text-lg font-bold bg-slate-50"
                              >
                                −
                              </button>
                              <span className="w-10 text-center font-bold text-base">{qty}</span>
                              <button
                                onClick={() => adjustQty(o.lineId, 1, bal)}
                                className="w-10 h-10 rounded-lg border border-slate-300 text-lg font-bold bg-slate-50"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {mode === 'IN' && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">
                    Vehicle entry will record exact timestamp & weigh-in weight, marking vehicle status <strong>INSIDE</strong>. Linked PO deliveries auto-generate a draft GRN for Stores.
                  </div>
                )}
              </div>

              <button
                disabled={loading}
                onClick={handleAllowAndPrint}
                className="w-full min-h-[64px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 className="w-6 h-6" />
                {loading ? 'Processing...' : 'Allow & Print'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'REGISTER' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Pass No</th>
                <th className="px-4 py-3 text-left">Direction / Type</th>
                <th className="px-4 py-3 text-left">Vehicle</th>
                <th className="px-4 py-3 text-left">Party</th>
                <th className="px-4 py-3 text-left">Net Weight</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {passes.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-700">{p.passNo}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-medium">{p.direction} / {p.passType}</span>
                  </td>
                  <td className="px-4 py-3 font-mono">{p.vehicleNo}</td>
                  <td className="px-4 py-3">{p.supplierName || p.customerName || p.partyName || '-'}</td>
                  <td className="px-4 py-3 text-xs font-mono">
                    {p.netKg !== null && p.netKg !== undefined ? `${p.netKg} kg` : p.weighInKg ? `In: ${p.weighInKg} kg` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      p.status === 'EXITED' || p.status === 'CLOSED'
                        ? 'bg-emerald-100 text-emerald-700'
                        : p.status === 'INSIDE'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {p.isChallan && (
                      <a
                        href={`/api/v1/gate-passes/${p.id}/print`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                      >
                        <Printer className="w-3.5 h-3.5" /> Challan
                      </a>
                    )}
                    {p.direction === 'IN' && p.status === 'INSIDE' && (
                      <button
                        onClick={async () => {
                          const w = prompt('Enter weigh-out kg:');
                          if (w) {
                            await logisticsApi.weighGatePass(p.id, Number(w));
                            await loadAll();
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-indigo-700"
                      >
                        <Scale className="w-3.5 h-3.5" /> Weigh
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'OVERDUE' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left">Pass No</th>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-right">Sent / Balance</th>
                <th className="px-4 py-3 text-left">Job Work Cat</th>
                <th className="px-4 py-3 text-left">Statutory Due (s.143)</th>
                <th className="px-4 py-3 text-left">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overdue.map((o) => (
                <tr key={o.lineId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold">{o.passNo}</td>
                  <td className="px-4 py-3">{o.description}</td>
                  <td className="px-4 py-3 text-right font-mono">{o.qty} / {o.balanceQty}</td>
                  <td className="px-4 py-3 text-xs">{o.jobworkCategory}</td>
                  <td className="px-4 py-3 text-xs">
                    {o.statutoryDueDate ? String(o.statutoryDueDate).slice(0, 10) : 'Exempt'}
                    {o.deemedSupplyRisk && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">DEEMED SUPPLY RISK</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {o.overdueDays > 0 ? (
                      <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-semibold">
                        {o.overdueDays}d overdue
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">Within limit</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
