// apps/web/src/pages/payroll/PayBankPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox, inr } from '../finance/shared';
import {
  getBankTemplates,
  getBankBatches,
  generateBankBatch,
  getPayrollRuns,
} from '../../lib/payrollApi';

export function PayBankPage() {
  const [batches, setBatches] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedCsv, setGeneratedCsv] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [b, t, r] = await Promise.all([getBankBatches(), getBankTemplates(), getPayrollRuns()]);
      setBatches(b);
      setTemplates(t);
      const filteredRuns = r.filter((run) => run.status === 'LOCKED' || run.status === 'POSTED');
      setRuns(filteredRuns);
      if (t.length > 0 && t[0]) setSelectedTemplateId(t[0].id);
      if (filteredRuns.length > 0 && filteredRuns[0]) setSelectedRunId(filteredRuns[0].id);
    } catch (e: any) {
      setError(e.message || 'Failed to load bank transfer dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGenerate = async () => {
    if (!selectedRunId || !selectedTemplateId) {
      alert('Please select a payroll run and bank template');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await generateBankBatch({
        payroll_run_id: selectedRunId,
        bank_template_id: selectedTemplateId,
      });
      setGeneratedCsv(res.csvContent);
      loadData();
    } catch (e: any) {
      setError(e.message || 'Batch generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!generatedCsv) return;
    const blob = new Blob([generatedCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Salary-Disbursement-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Bank Transfer Batches"
        sub="Corporate Salary Bulk Payment Files, IFSC Validation & Aadhaar/Bank Decryption Vault Integration"
      />

      <ErrorBox message={error} />

      {/* Batch Generator Panel */}
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-base font-semibold text-gray-900 border-b pb-2">Generate Bank Salary File</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Select Payroll Run (Locked/Posted) *</label>
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="w-full px-3 py-2 border rounded text-xs focus:outline-none"
            >
              {runs.length === 0 ? (
                <option value="">No locked or posted runs available</option>
              ) : (
                runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.run_no} ({r.period_month}) - {inr(r.total_net)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Bank Template Format *</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full px-3 py-2 border rounded text-xs focus:outline-none"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.bank_name})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleGenerate}
              disabled={loading || runs.length === 0}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white rounded text-xs font-semibold"
            >
              {loading ? 'Generating...' : 'Generate Batch & Decrypt Accounts'}
            </button>
          </div>
        </div>

        {generatedCsv && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex justify-between items-center">
            <div>
              <p className="text-xs font-bold text-emerald-900">Salary Batch File Generated Successfully!</p>
              <p className="text-xs text-emerald-700 mt-0.5">Ready for upload to Corporate Net Banking Portal.</p>
            </div>
            <button
              onClick={handleDownloadCsv}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold"
            >
              Download CSV
            </button>
          </div>
        )}
      </div>

      {/* Batches Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900 text-sm">Disbursement Batches History</h3>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-gray-600 font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Batch No</th>
              <th className="px-4 py-3 text-left">Payroll Run</th>
              <th className="px-4 py-3 text-left">Bank Template</th>
              <th className="px-4 py-3 text-right">Records</th>
              <th className="px-4 py-3 text-right">Disbursable Amount</th>
              <th className="px-4 py-3 text-left">Generated At</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {batches.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No bank transfer batches created yet.
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-600">{b.batch_no}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.run_no}</td>
                  <td className="px-4 py-3 text-gray-600">{b.template_name}</td>
                  <td className="px-4 py-3 text-right">{b.total_records}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600">{inr(b.total_amount)}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono">{new Date(b.generated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <Pill tone={b.status === 'GENERATED' ? 'accent' : b.status === 'ACKED' ? 'good' : 'warn'}>
                      {b.status}
                    </Pill>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
