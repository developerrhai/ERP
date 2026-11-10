// apps/web/src/pages/payroll/PayProcessingPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox, inr } from '../finance/shared';
import {
  getPayrollPeriods,
  getPayrollRuns,
  createPayrollRun,
  calculatePayrollRun,
  lockPayrollRun,
  postPayrollRun,
  getPayrollRun,
  releasePayslips,
  type PayrollPeriod,
} from '../../lib/payrollApi';

export function PayProcessingPage() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [activeRun, setActiveRun] = useState<any>(null);
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const p = await getPayrollPeriods();
      setPeriods(p);
      if (p.length > 0 && p[0]) {
        setSelectedPeriodId(p[0].id);
        const r = await getPayrollRuns({ period_id: p[0].id });
        if (r.length > 0 && r[0]) {
          const full = await getPayrollRun(r[0].id);
          setActiveRun(full);
          setStep(full.status === 'POSTED' ? 5 : full.status === 'LOCKED' ? 4 : full.status === 'CALCULATED' ? 3 : 2);
        } else {
          setActiveRun(null);
          setStep(1);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load payroll processing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePeriodChange = async (pId: string) => {
    setSelectedPeriodId(pId);
    try {
      const r = await getPayrollRuns({ period_id: pId });
      if (r.length > 0 && r[0]) {
        const full = await getPayrollRun(r[0].id);
        setActiveRun(full);
        setStep(full.status === 'POSTED' ? 5 : full.status === 'LOCKED' ? 4 : full.status === 'CALCULATED' ? 3 : 2);
      } else {
        setActiveRun(null);
        setStep(1);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to fetch runs for period');
    }
  };

  const handleCreateRun = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await createPayrollRun({
        period_id: selectedPeriodId,
        run_type: 'REGULAR',
      });
      const full = await getPayrollRun(res.id);
      setActiveRun(full);
      setStep(2);
    } catch (e: any) {
      setError(e.message || 'Failed to create payroll run');
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async () => {
    if (!activeRun) return;
    try {
      setLoading(true);
      setError('');
      await calculatePayrollRun(activeRun.id);
      const updated = await getPayrollRun(activeRun.id);
      setActiveRun(updated);
      setStep(3);
    } catch (e: any) {
      setError(e.message || 'Calculation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async () => {
    if (!activeRun) return;
    try {
      setLoading(true);
      setError('');
      await lockPayrollRun(activeRun.id);
      const updated = await getPayrollRun(activeRun.id);
      setActiveRun(updated);
      setStep(4);
    } catch (e: any) {
      setError(e.message || 'Lock failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!activeRun) return;
    try {
      setLoading(true);
      setError('');
      await postPayrollRun(activeRun.id);
      await releasePayslips(activeRun.id);
      const updated = await getPayrollRun(activeRun.id);
      setActiveRun(updated);
      setStep(5);
    } catch (e: any) {
      setError(e.message || 'GL Posting failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Payroll Processing Wizard"
        sub="Monthly Salary Calculation, Statutory Deductions, TDS Projection, GL Journal & Bank Disbursement"
      />

      <ErrorBox message={error} />

      {/* Step Indicator Header */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex justify-between items-center text-xs font-semibold">
        <div className={`flex items-center gap-2 ${step >= 1 ? 'text-indigo-600' : 'text-gray-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-gray-200'}`}>1</span>
          <span>Period & Unit</span>
        </div>
        <div className="h-0.5 w-12 bg-gray-200" />
        <div className={`flex items-center gap-2 ${step >= 2 ? 'text-indigo-600' : 'text-gray-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-200'}`}>2</span>
          <span>Attendance Preflight</span>
        </div>
        <div className="h-0.5 w-12 bg-gray-200" />
        <div className={`flex items-center gap-2 ${step >= 3 ? 'text-indigo-600' : 'text-gray-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-gray-200'}`}>3</span>
          <span>Run Calculations</span>
        </div>
        <div className="h-0.5 w-12 bg-gray-200" />
        <div className={`flex items-center gap-2 ${step >= 4 ? 'text-indigo-600' : 'text-gray-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 4 ? 'bg-indigo-600 text-white' : 'bg-gray-200'}`}>4</span>
          <span>Lock Run</span>
        </div>
        <div className="h-0.5 w-12 bg-gray-200" />
        <div className={`flex items-center gap-2 ${step >= 5 ? 'text-indigo-600' : 'text-gray-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 5 ? 'bg-emerald-600 text-white' : 'bg-gray-200'}`}>5</span>
          <span>GL Post & Payslips</span>
        </div>
      </div>

      {/* Main Processing Body */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm space-y-6">
        {/* Step 1: Period Selection */}
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-semibold text-gray-700">Payroll Period:</label>
            <select
              value={selectedPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.month} ({p.start_date} to {p.end_date}, {p.days_basis} days) - {p.status}
                </option>
              ))}
            </select>
          </div>

          {!activeRun && (
            <button
              onClick={handleCreateRun}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium"
            >
              Start New Regular Run
            </button>
          )}

          {activeRun && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 font-mono">Run: {activeRun.run_no}</span>
              <Pill tone={activeRun.status === 'POSTED' ? 'good' : activeRun.status === 'LOCKED' ? 'warn' : 'accent'}>
                {activeRun.status}
              </Pill>
            </div>
          )}
        </div>

        {/* Wizard Step Actions */}
        {activeRun && (
          <div className="space-y-6">
            {/* Step 2: Trigger Calculation */}
            {activeRun.status === 'DRAFT' && (
              <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 text-center space-y-3">
                <h3 className="font-bold text-gray-900">Ready to Compute Payroll</h3>
                <p className="text-sm text-gray-600 max-w-lg mx-auto">
                  Click calculate to execute the 13-step statutory payroll algorithm: Attendance pro-ration, Code on Wages 50% test,
                  PF (EPS/EPF/EDLI), ESIC coverage, Maharashtra PT, MLWF, and FY 26-27 TDS projection.
                </p>
                <button
                  onClick={handleCalculate}
                  disabled={loading}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium text-sm shadow"
                >
                  {loading ? 'Executing Algorithms...' : 'Execute Calculation Engine'}
                </button>
              </div>
            )}

            {/* Step 3 & 4: Preview Run Totals */}
            {activeRun.status !== 'DRAFT' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <span className="text-xs font-bold text-gray-400 uppercase">Gross Earnings</span>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{inr(activeRun.total_gross)}</p>
                    <span className="text-xs text-gray-500">{activeRun.employee_count} employees</span>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <span className="text-xs font-bold text-gray-400 uppercase">Total Deductions</span>
                    <p className="text-2xl font-bold text-red-600 mt-1">{inr(activeRun.total_deductions)}</p>
                    <span className="text-xs text-gray-500">PF, ESIC, PT, MLWF, TDS</span>
                  </div>
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                    <span className="text-xs font-bold text-emerald-700 uppercase">Net Pay Disbursable</span>
                    <p className="text-2xl font-bold text-emerald-700 mt-1">{inr(activeRun.total_net)}</p>
                    <span className="text-xs text-emerald-600">Bank file total</span>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <span className="text-xs font-bold text-gray-400 uppercase">Total Employer CTC</span>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{inr(activeRun.total_employer_cost)}</p>
                    <span className="text-xs text-gray-500">Includes Bonus & Gratuity</span>
                  </div>
                </div>

                {/* Employee Breakdown Table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50 font-semibold text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Code</th>
                        <th className="px-3 py-2 text-left">Employee Name</th>
                        <th className="px-3 py-2 text-right">Paid Days</th>
                        <th className="px-3 py-2 text-right">Gross</th>
                        <th className="px-3 py-2 text-right">Deductions</th>
                        <th className="px-3 py-2 text-right">Net Pay</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {activeRun.employees?.map((emp: any) => (
                        <tr key={emp.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-indigo-600">{emp.emp_code}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{emp.full_name}</td>
                          <td className="px-3 py-2 text-right">{emp.paid_days}</td>
                          <td className="px-3 py-2 text-right font-medium">{inr(emp.gross)}</td>
                          <td className="px-3 py-2 text-right text-red-600">{inr(emp.deductions)}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-600">{inr(emp.net)}</td>
                          <td className="px-3 py-2">
                            <Pill tone={emp.status === 'OK' ? 'good' : 'bad'}>{emp.status}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Workflow Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  {activeRun.status === 'CALCULATED' && (
                    <button
                      onClick={handleLock}
                      disabled={loading}
                      className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium text-sm"
                    >
                      Lock Payroll Run (Freeze Writes)
                    </button>
                  )}

                  {activeRun.status === 'LOCKED' && (
                    <button
                      onClick={handlePost}
                      disabled={loading}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-sm"
                    >
                      Post to GL Ledger & Release Payslips
                    </button>
                  )}

                  {activeRun.status === 'POSTED' && (
                    <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                      <span>✓ Successfully Posted to GL Journal</span>
                      {activeRun.journal_id && <span className="font-mono text-xs">({activeRun.journal_id})</span>}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
