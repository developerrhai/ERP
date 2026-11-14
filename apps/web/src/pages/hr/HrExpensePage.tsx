// apps/web/src/pages/hr/HrExpensePage.tsx
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox, inr, Empty } from '../finance/shared';
import { getExpenseClaims, createExpenseClaim } from '../../lib/hrApi';
import { DateField } from '../../ui/components';

export function HrExpensePage() {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    claim_date: new Date().toISOString().slice(0, 10),
    amount: '',
    description: '',
  });

  const loadClaims = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getExpenseClaims();
      setClaims(data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load expense claims');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClaims();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createExpenseClaim({
        title: form.title,
        claim_date: form.claim_date,
        lines: [
          {
            expense_date: form.claim_date,
            description: form.description,
            claimed_amount: Number(form.amount),
          },
        ],
      });
      setIsOpen(false);
      setForm({ title: '', claim_date: new Date().toISOString().slice(0, 10), amount: '', description: '' });
      loadClaims();
    } catch (err: any) {
      alert(err.message || 'Failed to submit claim');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Expense Claims & Advances"
        sub="Employee Travel & Reimbursement Claims, Policy Limits, Receipt Checks & GL Posting (EMPLOYEE_PAYABLE)"
      >
        <button
          onClick={() => setIsOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium"
        >
          + File Expense Claim
        </button>
      </PageHead>

      <ErrorBox message={error} />

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-gray-600 font-medium">
            <tr>
              <th className="px-4 py-3 text-left">Claim No</th>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-right">Claimed</th>
              <th className="px-4 py-3 text-right">Approved</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {claims.length === 0 ? (
              <Empty cols={7}>{loading ? 'Loading claims...' : 'No expense claims submitted'}</Empty>
            ) : (
              claims.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-indigo-600">{c.claim_no}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.full_name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.claim_date}</td>
                  <td className="px-4 py-3 text-gray-800">{c.title}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{inr(c.total_claimed)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-600">{inr(c.total_approved)}</td>
                  <td className="px-4 py-3">
                    <Pill tone={c.status === 'POSTED' ? 'good' : c.status === 'REJECTED' ? 'bad' : 'warn'}>
                      {c.status}
                    </Pill>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">New Expense Claim</h3>
            <form onSubmit={handleSubmit} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-gray-700">Claim Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Client visit travel"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Date *</label>
                  <DateField
                    required
                    value={form.claim_date}
                    onChange={(e) => setForm({ ...form, claim_date: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Amount (INR) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Expense Details *</label>
                <textarea
                  rows={2}
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium"
                >
                  Submit Claim
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
