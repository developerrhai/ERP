// apps/web/src/pages/hr/HrEmployeesPage.tsx
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Field, SelectField } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAppContext } from '../../lib/context';
import { toUiError, type UiError } from '../../lib/errors';
import {
  createHrEmployee,
  getHrEmployee,
  getHrEmployees,
  revealSensitiveEmployeeData,
  type HrEmployee,
} from '../../lib/hrApi';
import { fetchDepartments } from '../users/usersApi';
import { dmy, Empty, ErrorBox, PageHead, Pill } from '../finance/shared';

interface OnboardFormState {
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dob: string;
  joiningDate: string;
  mobile: string;
  personalEmail: string;
  unitId: string;
  department: string;
  aadhaar: string;
  pan: string;
}

const emptyForm = (unitId: string, department: string): OnboardFormState => ({
  firstName: '',
  lastName: '',
  gender: 'MALE',
  dob: '',
  joiningDate: '',
  mobile: '',
  personalEmail: '',
  unitId,
  department,
  aadhaar: '',
  pan: '',
});

export function HrEmployeesPage() {
  const toast = useToast();
  const ctx = useAppContext().data;
  const units = ctx?.units ?? [];
  const defaultUnitId = ctx?.current.unitId ?? units[0]?.id ?? '';

  const [departments, setDepartments] = useState<string[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<HrEmployee | null>(null);
  const [sensitiveReason, setSensitiveReason] = useState('');
  const [revealedAadhaar, setRevealedAadhaar] = useState<string | null>(null);
  const [revealError, setRevealError] = useState('');

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<UiError | null>(null);
  const [newForm, setNewForm] = useState<OnboardFormState>(() =>
    emptyForm(defaultUnitId, ''),
  );

  useEffect(() => {
    let alive = true;
    fetchDepartments()
      .then((list) => {
        if (alive) setDepartments(list);
      })
      .catch(() => {
        // Department dropdown still falls back cleanly if metadata request fails
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getHrEmployees({ q: search.trim() || undefined });
      setEmployees(res.rows);
    } catch (e: unknown) {
      setError(toUiError(e).message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openModal = () => {
    setFormErr(null);
    setNewForm(emptyForm(defaultUnitId, departments[0] ?? 'Production'));
    setIsNewModalOpen(true);
  };

  const handleSelect = async (emp: HrEmployee) => {
    try {
      setRevealedAadhaar(null);
      setRevealError('');
      setSensitiveReason('');
      const full = await getHrEmployee(emp.id);
      setSelectedEmp(full);
    } catch (e: unknown) {
      setError(toUiError(e).message);
    }
  };

  const handleReveal = async () => {
    if (!selectedEmp) return;
    if (sensitiveReason.trim().length < 5) {
      setRevealError('Enter a reason of at least 5 characters for the audit trail.');
      return;
    }
    try {
      setRevealError('');
      const res = await revealSensitiveEmployeeData(
        selectedEmp.id,
        'aadhaar',
        sensitiveReason.trim(),
      );
      setRevealedAadhaar(res.value);
    } catch (e: unknown) {
      setRevealError(toUiError(e).message);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const unitId = newForm.unitId || defaultUnitId;
    const fields: Record<string, string> = {};
    if (!newForm.firstName.trim()) fields.firstName = 'First name is required.';
    if (!newForm.lastName.trim()) fields.lastName = 'Last name is required.';
    if (!unitId) fields.unitId = 'Select a factory unit.';
    if (!newForm.department.trim()) fields.department = 'Department is required.';
    if (!newForm.dob) fields.dob = 'Date of birth is required.';
    if (!newForm.joiningDate) fields.joiningDate = 'Date of joining is required.';
    if (!/^[6-9]\d{9}$/.test(newForm.mobile.trim())) {
      fields.mobile = 'Enter a valid 10-digit Indian mobile number.';
    }
    if (Object.keys(fields).length > 0) {
      setFormErr({ message: 'Please check the highlighted fields.', fields, code: 'LOCAL' });
      return;
    }

    setSaving(true);
    setFormErr(null);
    try {
      const created = await createHrEmployee({
        firstName: newForm.firstName.trim(),
        lastName: newForm.lastName.trim(),
        gender: newForm.gender,
        dob: newForm.dob,
        joiningDate: newForm.joiningDate,
        mobile: newForm.mobile.trim(),
        ...(newForm.personalEmail.trim() ? { personalEmail: newForm.personalEmail.trim() } : {}),
        ...(newForm.pan.trim() ? { pan: newForm.pan.trim().toUpperCase() } : {}),
        ...(newForm.aadhaar.trim() ? { aadhaar: newForm.aadhaar.replace(/\s+/g, '') } : {}),
        unitId,
        department: newForm.department.trim(),
      });
      setIsNewModalOpen(false);
      toast(`Employee ${created.empCode} (${created.firstName} ${created.lastName}) onboarded.`);
      await loadData();
    } catch (err: unknown) {
      setFormErr(toUiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHead
        title="Employee Directory"
        sub="Comprehensive Employee Master, Identity Vault, Assignments & DPDP Compliance"
      >
        <button type="button" className="btn primary" onClick={openModal}>
          + Onboard Employee
        </button>
      </PageHead>

      <ErrorBox message={error} />

      <div className="recordbar" style={{ marginBottom: 16 }}>
        <input
          type="search"
          aria-label="Search employees"
          placeholder="Search by Code, Name, or Mobile..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => void loadData()}>
          Refresh
        </button>
      </div>

      <div className="grid2" style={{ alignItems: 'start', gap: 16 }}>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Department</th>
                <th scope="col">Designation</th>
                <th scope="col">Mobile</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <Empty cols={6}>{loading ? 'Loading employees…' : 'No employees found'}</Empty>
              ) : (
                employees.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => void handleSelect(emp)}
                    style={{
                      cursor: 'pointer',
                      background:
                        selectedEmp?.id === emp.id ? 'var(--primary-subtle, #eef2ff)' : undefined,
                    }}
                  >
                    <td>
                      <strong>{emp.empCode}</strong>
                    </td>
                    <td>
                      {emp.firstName} {emp.lastName}
                    </td>
                    <td>{emp.department || '—'}</td>
                    <td>{emp.designationName || '—'}</td>
                    <td>{emp.mobile}</td>
                    <td>
                      <Pill tone={emp.status === 'ACTIVE' ? 'good' : 'warn'}>{emp.status}</Pill>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Employee Details & Vault</h3>
          {selectedEmp ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {selectedEmp.firstName} {selectedEmp.lastName}
                </div>
                <div className="v8-sub">
                  {selectedEmp.empCode} · {selectedEmp.gender}
                  {selectedEmp.unitName ? ` · ${selectedEmp.unitName}` : ''}
                </div>
              </div>

              <div className="grid2" style={{ fontSize: 13, gap: 8 }}>
                <div>
                  <span className="v8-sub">DOJ:</span> {dmy(selectedEmp.joiningDate)}
                </div>
                <div>
                  <span className="v8-sub">DOB:</span> {dmy(selectedEmp.dob)}
                </div>
                <div>
                  <span className="v8-sub">Mobile:</span> {selectedEmp.mobile}
                </div>
                <div>
                  <span className="v8-sub">Biometric:</span> {selectedEmp.biometricCode || 'Not set'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--card2, #f8fafc)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  Identity & Statutory Vault (DPDP Masked)
                </div>
                <div>
                  <span className="v8-sub">Aadhaar:</span>{' '}
                  {selectedEmp.aadhaarLast4 ? `XXXX-XXXX-${selectedEmp.aadhaarLast4}` : '—'}
                </div>
                <div>
                  <span className="v8-sub">PAN:</span> {selectedEmp.pan || '—'}
                </div>
                <div>
                  <span className="v8-sub">UAN:</span> {selectedEmp.uan || '—'}
                </div>
                <div>
                  <span className="v8-sub">ESIC:</span> {selectedEmp.esicIp || '—'}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Audited Sensitive Reveal (PII Logged)
                </div>
                {revealedAadhaar ? (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fcd34d',
                      borderRadius: 8,
                      padding: 10,
                      fontSize: 13,
                    }}
                  >
                    <strong>REVEALED (LOGGED TO AUDIT):</strong> Aadhaar {revealedAadhaar}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      aria-label="Audit reveal reason"
                      placeholder="Audit reason (min 5 chars)..."
                      value={sensitiveReason}
                      onChange={(e) => setSensitiveReason(e.target.value)}
                    />
                    <ErrorBox message={revealError} />
                    <button type="button" className="btn" onClick={() => void handleReveal()}>
                      Reveal Full Aadhaar
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="v8-sub">Select an employee to view details.</p>
          )}
        </div>
      </div>

      {isNewModalOpen ? (
        <Modal
          title="Onboard New Employee"
          sub="Employee code is automatically assigned on save."
          onClose={() => setIsNewModalOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setIsNewModalOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                form="hr-onboard-form"
                className="btn primary"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save & Encrypt Vault'}
              </button>
            </>
          }
        >
          <form id="hr-onboard-form" onSubmit={(e) => void handleCreate(e)} noValidate>
            <ErrorBox message={formErr?.message ?? ''} />
            <div className="form-grid">
              <Field
                label="First Name *"
                value={newForm.firstName}
                error={formErr?.fields.firstName}
                onChange={(e) => setNewForm({ ...newForm, firstName: e.target.value })}
              />
              <Field
                label="Last Name *"
                value={newForm.lastName}
                error={formErr?.fields.lastName}
                onChange={(e) => setNewForm({ ...newForm, lastName: e.target.value })}
              />
              <SelectField
                label="Gender *"
                value={newForm.gender}
                onChange={(v) =>
                  setNewForm({ ...newForm, gender: v as OnboardFormState['gender'] })
                }
              >
                <option value="MALE">MALE</option>
                <option value="FEMALE">FEMALE</option>
                <option value="OTHER">OTHER</option>
              </SelectField>
              <SelectField
                label="Unit *"
                value={newForm.unitId || defaultUnitId}
                error={formErr?.fields.unitId}
                onChange={(v) => setNewForm({ ...newForm, unitId: v })}
              >
                <option value="">Select unit…</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </SelectField>
              {departments.length > 0 ? (
                <SelectField
                  label="Department *"
                  value={newForm.department}
                  error={formErr?.fields.department}
                  onChange={(v) => setNewForm({ ...newForm, department: v })}
                >
                  <option value="">Select department…</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <Field
                  label="Department *"
                  value={newForm.department}
                  error={formErr?.fields.department}
                  onChange={(e) => setNewForm({ ...newForm, department: e.target.value })}
                />
              )}
              <Field
                label="Date of Birth *"
                type="date"
                value={newForm.dob}
                error={formErr?.fields.dob}
                onChange={(e) => setNewForm({ ...newForm, dob: e.target.value })}
              />
              <Field
                label="Date of Joining *"
                type="date"
                value={newForm.joiningDate}
                error={formErr?.fields.joiningDate}
                onChange={(e) => setNewForm({ ...newForm, joiningDate: e.target.value })}
              />
              <Field
                label="Mobile (10 digits) *"
                type="tel"
                value={newForm.mobile}
                error={formErr?.fields.mobile}
                onChange={(e) => setNewForm({ ...newForm, mobile: e.target.value })}
              />
              <Field
                label="Personal Email"
                type="email"
                value={newForm.personalEmail}
                error={formErr?.fields.personalEmail}
                onChange={(e) => setNewForm({ ...newForm, personalEmail: e.target.value })}
              />
              <Field
                label="Aadhaar (12 digits) *"
                value={newForm.aadhaar}
                error={formErr?.fields.aadhaar}
                onChange={(e) => setNewForm({ ...newForm, aadhaar: e.target.value })}
              />
              <Field
                label="PAN Card *"
                value={newForm.pan}
                error={formErr?.fields.pan}
                onChange={(e) => setNewForm({ ...newForm, pan: e.target.value })}
              />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
