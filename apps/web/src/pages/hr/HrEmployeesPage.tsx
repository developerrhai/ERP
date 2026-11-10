// apps/web/src/pages/hr/HrEmployeesPage.tsx
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { getHrEmployees, getHrEmployee, revealSensitiveEmployeeData, createHrEmployee, type HrEmployee } from '../../lib/hrApi';
import { PageHead, Pill, ErrorBox, Empty } from '../finance/shared';

export function HrEmployeesPage() {
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [sensitiveReason, setSensitiveReason] = useState('');
  const [sensitiveData, setSensitiveData] = useState<any>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    emp_code: '',
    first_name: '',
    last_name: '',
    gender: 'MALE',
    date_of_birth: '',
    date_of_joining: '',
    mobile: '',
    personal_email: '',
    department: '',
    designation: '',
    aadhaar_number: '',
    pan: '',
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getHrEmployees({ q: search || undefined });
      setEmployees(res.rows);
    } catch (e: any) {
      setError(e.message || 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search]);

  const handleSelect = async (emp: HrEmployee) => {
    try {
      setSensitiveData(null);
      setSensitiveReason('');
      const full = await getHrEmployee(emp.id);
      setSelectedEmp(full);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch employee details');
    }
  };

  const handleReveal = async () => {
    if (!sensitiveReason || sensitiveReason.trim().length < 5) {
      alert('Please enter a valid reason (min 5 characters) for audit trail.');
      return;
    }
    try {
      const data = await revealSensitiveEmployeeData(selectedEmp.id, sensitiveReason);
      setSensitiveData(data);
    } catch (e: any) {
      alert(e.message || 'Failed to reveal sensitive data');
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createHrEmployee({
        ...newForm,
        unit_id: '00000000-0000-0000-0000-000000000000', // default company unit
      });
      setIsNewModalOpen(false);
      setNewForm({
        emp_code: '',
        first_name: '',
        last_name: '',
        gender: 'MALE',
        date_of_birth: '',
        date_of_joining: '',
        mobile: '',
        personal_email: '',
        department: '',
        designation: '',
        aadhaar_number: '',
        pan: '',
      });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create employee');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Employee Directory"
        sub="Comprehensive Employee Master, Identity Vault, Assignments & DPDP Compliance"
      >
        <button
          onClick={() => setIsNewModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium"
        >
          + Onboard Employee
        </button>
      </PageHead>

      <ErrorBox message={error} />

      {/* Filter Toolbar */}
      <div className="flex gap-4 items-center bg-white p-4 rounded-lg border border-gray-200">
        <input
          type="text"
          placeholder="Search by Code, Name, Mobile or Department..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={loadData}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Employee List */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Department</th>
                  <th className="px-4 py-3 text-left">Designation</th>
                  <th className="px-4 py-3 text-left">Mobile</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {employees.length === 0 ? (
                  <Empty cols={6}>{loading ? 'Loading employees...' : 'No employees found'}</Empty>
                ) : (
                  employees.map((emp) => (
                    <tr
                      key={emp.id}
                      onClick={() => handleSelect(emp)}
                      className={`cursor-pointer hover:bg-indigo-50 transition-colors ${
                        selectedEmp?.id === emp.id ? 'bg-indigo-50 font-medium' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-indigo-600 font-mono">{emp.emp_code}</td>
                      <td className="px-4 py-3 text-gray-900">{emp.full_name}</td>
                      <td className="px-4 py-3 text-gray-600">{emp.department || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{emp.designation || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{emp.mobile}</td>
                      <td className="px-4 py-3">
                        <Pill tone={emp.status === 'ACTIVE' ? 'good' : 'warn'}>{emp.status}</Pill>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Employee Details & Identity Vault */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-gray-900 border-b pb-2">Employee Details & Vault</h3>
          {selectedEmp ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">Employee</p>
                <p className="text-lg font-bold text-gray-900">{selectedEmp.full_name}</p>
                <p className="text-gray-500 font-mono text-xs">{selectedEmp.emp_code} • {selectedEmp.gender}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-400">DOJ:</span> {selectedEmp.date_of_joining}
                </div>
                <div>
                  <span className="text-gray-400">DOB:</span> {selectedEmp.date_of_birth}
                </div>
                <div>
                  <span className="text-gray-400">Mobile:</span> {selectedEmp.mobile}
                </div>
                <div>
                  <span className="text-gray-400">Biometric PIN:</span> {selectedEmp.biometric_pin || 'Not set'}
                </div>
              </div>

              {/* Statutory Masked Info */}
              <div className="bg-gray-50 p-3 rounded border border-gray-200 space-y-2">
                <p className="font-semibold text-xs text-gray-700">Identity & Statutory Vault (DPDP Masked)</p>
                <div className="text-xs space-y-1">
                  <p><span className="text-gray-400">Aadhaar:</span> {selectedEmp.identity?.aadhaar_masked || 'XXXX-XXXX-XXXX'}</p>
                  <p><span className="text-gray-400">PAN:</span> {selectedEmp.identity?.pan_masked || 'XXXXX0000X'}</p>
                  <p><span className="text-gray-400">UAN:</span> {selectedEmp.identity?.uan || '—'}</p>
                  <p><span className="text-gray-400">ESIC:</span> {selectedEmp.identity?.esic_number || '—'}</p>
                </div>
              </div>

              {/* Sensitive Reveal Action */}
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium text-gray-700">Audited Sensitive Reveal (PII Logged)</p>
                {sensitiveData ? (
                  <div className="bg-amber-50 p-3 rounded border border-amber-200 text-xs font-mono space-y-1">
                    <p className="text-red-700 font-bold">REVEALED (LOGGED TO AUDIT):</p>
                    <p>Aadhaar: {sensitiveData.aadhaar}</p>
                    <p>PAN: {sensitiveData.pan}</p>
                    <p>Bank Acc: {sensitiveData.bank_account}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Audit reason (e.g. Bank verification)..."
                      value={sensitiveReason}
                      onChange={(e) => setSensitiveReason(e.target.value)}
                      className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none"
                    />
                    <button
                      onClick={handleReveal}
                      className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium"
                    >
                      Reveal Full Aadhaar / Bank
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-10">Select an employee to view details</p>
          )}
        </div>
      </div>

      {/* Onboarding Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">Onboard New Employee</h3>
            <form onSubmit={handleCreate} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Emp Code *</label>
                  <input
                    type="text"
                    required
                    value={newForm.emp_code}
                    onChange={(e) => setNewForm({ ...newForm, emp_code: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Gender *</label>
                  <select
                    value={newForm.gender}
                    onChange={(e) => setNewForm({ ...newForm, gender: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  >
                    <option value="MALE">MALE</option>
                    <option value="FEMALE">FEMALE</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">First Name *</label>
                  <input
                    type="text"
                    required
                    value={newForm.first_name}
                    onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={newForm.last_name}
                    onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Date of Birth *</label>
                  <input
                    type="date"
                    required
                    value={newForm.date_of_birth}
                    onChange={(e) => setNewForm({ ...newForm, date_of_birth: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Date of Joining *</label>
                  <input
                    type="date"
                    required
                    value={newForm.date_of_joining}
                    onChange={(e) => setNewForm({ ...newForm, date_of_joining: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Mobile (10 digits) *</label>
                  <input
                    type="tel"
                    required
                    value={newForm.mobile}
                    onChange={(e) => setNewForm({ ...newForm, mobile: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">Personal Email</label>
                  <input
                    type="email"
                    value={newForm.personal_email}
                    onChange={(e) => setNewForm({ ...newForm, personal_email: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700">Aadhaar (12 digits) *</label>
                  <input
                    type="text"
                    required
                    value={newForm.aadhaar_number}
                    onChange={(e) => setNewForm({ ...newForm, aadhaar_number: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700">PAN Card *</label>
                  <input
                    type="text"
                    required
                    value={newForm.pan}
                    onChange={(e) => setNewForm({ ...newForm, pan: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium"
                >
                  Save & Encrypt Vault
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
