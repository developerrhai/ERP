// apps/web/src/pages/hr/HrLeavePage.tsx
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { PageHead, ErrorBox } from '../finance/shared';
import { getLeaveBalances, applyLeave, getHrEmployees } from '../../lib/hrApi';

export function HrLeavePage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [balances, setBalances] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [applyForm, setApplyForm] = useState({
    leave_type_code: 'EL',
    from_date: '',
    to_date: '',
    reason: '',
  });

  useEffect(() => {
    getHrEmployees().then((res) => {
      setEmployees(res.rows);
      if (res.rows.length > 0 && res.rows[0]) setSelectedEmpId(res.rows[0].id);
    });
  }, []);

  const loadBalances = async (empId: string) => {
    try {
      setError('');
      const data = await getLeaveBalances(empId);
      setBalances(data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load leave balances');
    }
  };

  useEffect(() => {
    if (selectedEmpId) loadBalances(selectedEmpId);
  }, [selectedEmpId]);

  const handleApply = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await applyLeave({
        employee_id: selectedEmpId,
        ...applyForm,
      });
      setIsApplyModalOpen(false);
      setApplyForm({ leave_type_code: 'EL', from_date: '', to_date: '', reason: '' });
      loadBalances(selectedEmpId);
    } catch (err: any) {
      alert(err.message || 'Failed to apply leave');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Leave Management & Append-Only Ledger"
        sub="Accrual Algorithms C, D (Sandwich Rule), E (Comp-off Expiry) & Balance Invariants"
      >
        <button
          onClick={() => setIsApplyModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium"
        >
          Apply Leave
        </button>
      </PageHead>

      <ErrorBox message={error} />

      <div className="flex items-center gap-4 bg-white p-4 rounded-lg border border-gray-200">
        <label className="text-sm font-medium text-gray-700">Select Employee:</label>
        <select
          value={selectedEmpId}
          onChange={(e) => setSelectedEmpId(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none"
        >
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.emp_code} - {emp.full_name} ({emp.department || 'General'})
            </option>
          ))}
        </select>
      </div>

      {/* Leave Balances Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {balances.map((b) => (
          <div key={b.code} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{b.code}</span>
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Append-only</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-2">{b.balance ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">{b.name}</p>
          </div>
        ))}
      </div>

      {/* Apply Leave Modal */}
      {isApplyModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Apply for Leave</h3>
            <form onSubmit={handleApply} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-gray-700">Leave Type</label>
                <select
                  value={applyForm.leave_type_code}
                  onChange={(e) => setApplyForm({ ...applyForm, leave_type_code: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded focus:outline-none"
                >
                  <option value="EL">Earned Leave (EL)</option>
                  <option value="CL">Casual Leave (CL)</option>
                  <option value="SL">Sick Leave (SL)</option>
                  <option value="COMP">Compensatory Off (COMP)</option>
                  <option value="LOP">Loss of Pay (LOP)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">From Date</label>
                  <input
                    type="date"
                    required
                    value={applyForm.from_date}
                    onChange={(e) => setApplyForm({ ...applyForm, from_date: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">To Date</label>
                  <input
                    type="date"
                    required
                    value={applyForm.to_date}
                    onChange={(e) => setApplyForm({ ...applyForm, to_date: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Reason</label>
                <textarea
                  required
                  rows={3}
                  value={applyForm.reason}
                  onChange={(e) => setApplyForm({ ...applyForm, reason: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsApplyModalOpen(false)}
                  className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium"
                >
                  Submit Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
