// apps/web/src/pages/payroll/StatutoryRatesPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox } from '../finance/shared';
import { getStatutoryRates, reviewStatutoryRate } from '../../lib/payrollApi';

export function StatutoryRatesPage() {
  const [rates, setRates] = useState<any[]>([]);
  const [error, setError] = useState('');

  const loadRates = async () => {
    try {
      setError('');
      const data = await getStatutoryRates();
      setRates(data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load statutory rates');
    }
  };

  useEffect(() => {
    loadRates();
  }, []);

  const handleReview = async (id: string) => {
    try {
      await reviewStatutoryRate(id);
      loadRates();
    } catch (e: any) {
      alert(e.message || 'Failed to update review status');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Statutory Rates Master"
        sub="Indian Labour & Tax Regulations: PF, ESIC, Maharashtra PT, MLWF, Bonus & FY 2026-27 Slabs"
      />

      <ErrorBox message={error} />

      <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg text-xs text-amber-800">
        <p className="font-bold">Compliance Rule (R-21 Decisions):</p>
        <p className="mt-1">
          Statutory rates are stored as versioned configuration records with official source URLs. No rate or threshold is hardcoded in application logic.
          Rows flagged with <strong>Needs Review</strong> must be verified and approved by the Compliance or Payroll Manager before locking runs.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-gray-600 font-medium">
            <tr>
              <th className="px-4 py-3 text-left">Rate Type</th>
              <th className="px-4 py-3 text-left">Effective From</th>
              <th className="px-4 py-3 text-right">Rate / %</th>
              <th className="px-4 py-3 text-right">Fixed / Cap</th>
              <th className="px-4 py-3 text-left">Official Source</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rates.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-900">{r.rate_type}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.effective_from}</td>
                <td className="px-4 py-3 text-right font-mono font-medium">
                  {r.rate !== null ? `${(Number(r.rate) * 100).toFixed(2)} %` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {r.cap ? `₹ ${Number(r.cap).toLocaleString('en-IN')}` : r.amount ? `₹ ${Number(r.amount).toLocaleString('en-IN')}` : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-indigo-600 truncate max-w-xs">
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {r.source_url}
                  </a>
                </td>
                <td className="px-4 py-3">
                  <Pill tone={r.needs_review ? 'warn' : 'good'}>
                    {r.needs_review ? 'Needs Review' : 'Verified'}
                  </Pill>
                </td>
                <td className="px-4 py-3 text-center">
                  {r.needs_review ? (
                    <button
                      onClick={() => handleReview(r.id)}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold"
                    >
                      Mark Reviewed
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">✓ Reviewed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
