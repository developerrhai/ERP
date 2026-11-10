// apps/web/src/pages/payroll/PayStructurePage.tsx
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox } from '../finance/shared';
import {
  getPayComponents,
  createPayComponent,
  getPayStructures,
  type PayComponent,
} from '../../lib/payrollApi';

export function PayStructurePage() {
  const [components, setComponents] = useState<PayComponent[]>([]);
  const [structures, setStructures] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [isCompModalOpen, setIsCompModalOpen] = useState(false);
  const [compForm, setCompForm] = useState({
    code: '',
    name: '',
    kind: 'EARNING' as 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIB',
    calc_type: 'FIXED' as 'FIXED' | 'FORMULA' | 'ATTENDANCE' | 'INPUT' | 'STATUTORY',
    code_wage_class: 'INCLUDED' as 'INCLUDED' | 'EXCLUDED',
    prorate: true,
    taxable: true,
    payslip_order: 10,
    payslip_label_hi: '',
  });

  const loadData = async () => {
    try {
      setError('');
      const [c, s] = await Promise.all([getPayComponents(), getPayStructures()]);
      setComponents(c);
      setStructures(s);
    } catch (e: any) {
      setError(e.message || 'Failed to load pay masters');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateComponent = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createPayComponent(compForm);
      setIsCompModalOpen(false);
      setCompForm({
        code: '',
        name: '',
        kind: 'EARNING',
        calc_type: 'FIXED',
        code_wage_class: 'INCLUDED',
        prorate: true,
        taxable: true,
        payslip_order: 10,
        payslip_label_hi: '',
      });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create pay component');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Pay Components & Salary Structures"
        sub="E-22 GL Keys, Code on Wages Classification (INCLUDED/EXCLUDED), Safe Formula Parser & Hierarchy"
      >
        <button
          onClick={() => setIsCompModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium"
        >
          + New Pay Component
        </button>
      </PageHead>

      <ErrorBox message={error} />

      {/* Pay Components Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm space-y-3 p-5">
        <h3 className="font-semibold text-gray-900 text-base border-b pb-2">Master Pay Components</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50 text-gray-600 font-semibold">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Hindi Label</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Calc Type</th>
                <th className="px-3 py-2 text-left">Code Wage Class</th>
                <th className="px-3 py-2 text-center">Prorate</th>
                <th className="px-3 py-2 text-center">Taxable</th>
                <th className="px-3 py-2 text-left">GL Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {components.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono font-bold text-indigo-600">{c.code}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{c.name}</td>
                  <td className="px-3 py-2 text-gray-500">{c.payslip_label_hi || '—'}</td>
                  <td className="px-3 py-2">
                    <Pill tone={c.kind === 'EARNING' ? 'good' : c.kind === 'DEDUCTION' ? 'warn' : 'accent'}>
                      {c.kind}
                    </Pill>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-600">{c.calc_type}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        c.code_wage_class === 'INCLUDED' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {c.code_wage_class}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">{c.prorate ? '✓' : '—'}</td>
                  <td className="px-3 py-2 text-center">{c.taxable ? '✓' : '—'}</td>
                  <td className="px-3 py-2 font-mono text-gray-500">{c.gl_key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pay Structures */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm space-y-4">
        <h3 className="font-semibold text-gray-900 text-base border-b pb-2">Configured Salary Structures</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {structures.map((s) => (
            <div key={s.id} className="p-4 rounded-lg border border-gray-200 bg-gray-50/50 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-gray-900 text-sm">{s.name}</span>
                <span className="font-mono text-xs text-indigo-600">{s.code}</span>
              </div>
              <p className="text-xs text-gray-500">{s.description || 'Standard corporate salary structure'}</p>
              <div className="border-t pt-2 mt-2">
                <span className="text-[11px] font-semibold text-gray-600 uppercase">Lines ({s.lines?.length || 0}):</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {s.lines?.map((l: any) => (
                    <span key={l.id} className="px-2 py-0.5 bg-white border text-gray-700 rounded text-xs font-mono">
                      {l.component_code}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal */}
      {isCompModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">New Pay Component</h3>
            <form onSubmit={handleCreateComponent} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SPECIAL"
                    value={compForm.code}
                    onChange={(e) => setCompForm({ ...compForm, code: e.target.value.toUpperCase() })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Kind *</label>
                  <select
                    value={compForm.kind}
                    onChange={(e) => setCompForm({ ...compForm, kind: e.target.value as any })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  >
                    <option value="EARNING">EARNING</option>
                    <option value="DEDUCTION">DEDUCTION</option>
                    <option value="EMPLOYER_CONTRIB">EMPLOYER_CONTRIB</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700">Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Special Allowance"
                  value={compForm.name}
                  onChange={(e) => setCompForm({ ...compForm, name: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Calc Type *</label>
                  <select
                    value={compForm.calc_type}
                    onChange={(e) => setCompForm({ ...compForm, calc_type: e.target.value as any })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  >
                    <option value="FIXED">FIXED</option>
                    <option value="FORMULA">FORMULA</option>
                    <option value="ATTENDANCE">ATTENDANCE</option>
                    <option value="INPUT">INPUT</option>
                    <option value="STATUTORY">STATUTORY</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Code Wage (50% test) *</label>
                  <select
                    value={compForm.code_wage_class}
                    onChange={(e) => setCompForm({ ...compForm, code_wage_class: e.target.value as any })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none font-semibold"
                  >
                    <option value="INCLUDED">INCLUDED</option>
                    <option value="EXCLUDED">EXCLUDED</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsCompModalOpen(false)}
                  className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium"
                >
                  Save Component
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
