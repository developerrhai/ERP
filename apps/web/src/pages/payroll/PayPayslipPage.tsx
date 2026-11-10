// apps/web/src/pages/payroll/PayPayslipPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, ErrorBox, inr } from '../finance/shared';
import { getPayrollRuns, getPayrollRun, getPayslip } from '../../lib/payrollApi';

export function PayPayslipPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runDetails, setRunDetails] = useState<any>(null);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [payslip, setPayslip] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getPayrollRuns().then((r) => {
      setRuns(r);
      if (r.length > 0 && r[0]) {
        setSelectedRunId(r[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedRunId) {
      getPayrollRun(selectedRunId).then((full) => {
        setRunDetails(full);
        if (full.employees?.length > 0) {
          setSelectedEmpId(full.employees[0].id);
        } else {
          setSelectedEmpId('');
          setPayslip(null);
        }
      });
    }
  }, [selectedRunId]);

  useEffect(() => {
    if (selectedEmpId) {
      setLoading(true);
      getPayslip(selectedEmpId)
        .then((slip) => setPayslip(slip))
        .catch((e) => setError(e.message || 'Failed to load payslip'))
        .finally(() => setLoading(false));
    }
  }, [selectedEmpId]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHead
        title="Payslip Generation & Viewer (V9.2 Layout)"
        sub="Indian Statutory Payslip Layout, Code on Wages Earnings Breakdown, Masked Aadhaar & Amount in Words"
      >
        {payslip && (
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium"
          >
            Print / Save PDF
          </button>
        )}
      </PageHead>

      <ErrorBox message={error} />

      {/* Selectors */}
      <div className="flex gap-4 items-center bg-white p-4 rounded-lg border border-gray-200">
        <div>
          <label className="text-xs font-semibold text-gray-700 block mb-1">Payroll Run:</label>
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="px-3 py-1.5 border rounded text-xs focus:outline-none"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.run_no} ({r.period_month}) - {r.status}
              </option>
            ))}
          </select>
        </div>

        {runDetails?.employees?.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Select Employee:</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="px-3 py-1.5 border rounded text-xs focus:outline-none"
            >
              {runDetails.employees.map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.emp_code} - {emp.full_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* V9.2 Standard Payslip Document */}
      {payslip ? (
        <div className="bg-white border-2 border-gray-300 rounded-lg p-8 shadow-sm space-y-6 print:border-none print:shadow-none">
          {/* Header */}
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold tracking-tight text-gray-900">RHAI ENTERPRISES PRIVATE LIMITED</h2>
            <p className="text-xs text-gray-500">MIDC Industrial Area, Pune, Maharashtra 411018</p>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-indigo-700 mt-2">
              Payslip for the month of {payslip.periodMonth}
            </h3>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{payslip.payslipNo}</p>
          </div>

          {/* Employee Meta Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs border-b pb-4 bg-gray-50/50 p-4 rounded">
            <div>
              <span className="text-gray-400">Employee Code:</span>
              <p className="font-semibold text-gray-900">{payslip.employee.code}</p>
            </div>
            <div>
              <span className="text-gray-400">Employee Name:</span>
              <p className="font-semibold text-gray-900">{payslip.employee.name}</p>
            </div>
            <div>
              <span className="text-gray-400">Department:</span>
              <p className="font-semibold text-gray-900">{payslip.employee.department || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">Designation:</span>
              <p className="font-semibold text-gray-900">{payslip.employee.designation || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">Date of Joining:</span>
              <p className="font-semibold text-gray-900">{payslip.employee.doj}</p>
            </div>
            <div>
              <span className="text-gray-400">PAN:</span>
              <p className="font-semibold text-gray-900 font-mono">{payslip.employee.pan || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">UAN:</span>
              <p className="font-semibold text-gray-900 font-mono">{payslip.employee.uan || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">Aadhaar (Masked):</span>
              <p className="font-semibold text-gray-900 font-mono">{payslip.employee.aadhaarMasked}</p>
            </div>
            <div>
              <span className="text-gray-400">Bank Name:</span>
              <p className="font-semibold text-gray-900">{payslip.employee.bankName || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">Account No (Masked):</span>
              <p className="font-semibold text-gray-900 font-mono">{payslip.employee.accountNoMasked}</p>
            </div>
            <div>
              <span className="text-gray-400">IFSC Code:</span>
              <p className="font-semibold text-gray-900 font-mono">{payslip.employee.ifsc || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">ESIC IP No:</span>
              <p className="font-semibold text-gray-900 font-mono">{payslip.employee.esicNo || '—'}</p>
            </div>
          </div>

          {/* Attendance Summary Strip */}
          <div className="flex justify-around bg-gray-100 p-2.5 rounded text-xs font-medium text-gray-700">
            <div>Calendar Days: <strong className="text-gray-900">{payslip.attendance.calendarDays}</strong></div>
            <div>Paid Days: <strong className="text-indigo-600">{payslip.attendance.paidDays}</strong></div>
            <div>LOP Days: <strong className="text-red-600">{payslip.attendance.lopDays}</strong></div>
            <div>NCP Days: <strong className="text-amber-600">{payslip.attendance.ncpDays}</strong></div>
          </div>

          {/* Dual Columns: Earnings vs Deductions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Earnings */}
            <div className="border rounded overflow-hidden">
              <table className="min-w-full text-xs divide-y divide-gray-200">
                <thead className="bg-gray-50 text-gray-700 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Earnings</th>
                    <th className="px-3 py-2 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payslip.earnings.map((e: any) => (
                    <tr key={e.code}>
                      <td className="px-3 py-2">
                        {e.name} {e.nameHi && <span className="text-gray-400">({e.nameHi})</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{inr(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-bold border-t">
                  <tr>
                    <td className="px-3 py-2">Total Gross Earnings</td>
                    <td className="px-3 py-2 text-right text-indigo-700">{inr(payslip.totals.gross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Deductions */}
            <div className="border rounded overflow-hidden">
              <table className="min-w-full text-xs divide-y divide-gray-200">
                <thead className="bg-gray-50 text-gray-700 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Deductions</th>
                    <th className="px-3 py-2 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payslip.deductions.map((d: any) => (
                    <tr key={d.code}>
                      <td className="px-3 py-2">{d.name}</td>
                      <td className="px-3 py-2 text-right font-medium text-red-600">{inr(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-bold border-t">
                  <tr>
                    <td className="px-3 py-2">Total Deductions</td>
                    <td className="px-3 py-2 text-right text-red-700">{inr(payslip.totals.deductions)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Net Salary Payable & Amount in Words */}
          <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-lg flex justify-between items-center">
            <div>
              <span className="text-xs uppercase tracking-wider font-semibold text-indigo-800">Net Salary Disbursable</span>
              <p className="text-xs font-semibold text-gray-700 mt-1">In Words: {payslip.totals.amountInWords}</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black text-indigo-900">{inr(payslip.totals.net)}</span>
            </div>
          </div>

          {/* Signatures & Footer Note */}
          <div className="pt-8 flex justify-between text-xs text-gray-400 border-t">
            <div>Computer generated payslip. Requires no physical signature.</div>
            <div>Authorized Signatory</div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-12 text-center text-gray-500 rounded-lg border">
          {loading ? 'Rendering payslip document...' : 'Select a payroll run and employee to view payslip.'}
        </div>
      )}
    </div>
  );
}
