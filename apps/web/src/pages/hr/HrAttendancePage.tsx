// apps/web/src/pages/hr/HrAttendancePage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox } from '../finance/shared';
import { getAttendanceDays } from '../../lib/hrApi';

export function HrAttendancePage() {
  const [month, setMonth] = useState('2027-02');
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadAttendance = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getAttendanceDays(month);
      setDays(data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
  }, [month]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Time & Attendance"
        sub="Biometric Punches, Shifts, Algorithms A & B, Regularisations and Period Summary"
      />

      <ErrorBox message={error} />

      {/* Control bar */}
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-gray-200">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Period Month:</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none"
          />
          <button
            onClick={loadAttendance}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium"
          >
            Load
          </button>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-medium">
            Sync Biometric Devices
          </button>
          <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-medium">
            Recompute Days
          </button>
        </div>
      </div>

      {/* Days Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-gray-600 font-medium">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Shift</th>
                <th className="px-4 py-3 text-left">First In</th>
                <th className="px-4 py-3 text-left">Last Out</th>
                <th className="px-4 py-3 text-left">Work Hours</th>
                <th className="px-4 py-3 text-left">Late / Early</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {days.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    {loading ? 'Loading attendance records...' : 'No attendance days computed for this period.'}
                  </td>
                </tr>
              ) : (
                days.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-900">{d.work_date}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{d.emp_code} - {d.full_name}</td>
                    <td className="px-4 py-3 text-gray-600">{d.shift_code || 'General'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{d.first_in ? new Date(d.first_in).toLocaleTimeString() : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{d.last_out ? new Date(d.last_out).toLocaleTimeString() : '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{d.work_minutes ? (d.work_minutes / 60).toFixed(1) + ' hrs' : '0 hrs'}</td>
                    <td className="px-4 py-3 text-xs text-amber-600">
                      {d.late_in_minutes ? `${d.late_in_minutes}m Late` : ''} {d.early_out_minutes ? `${d.early_out_minutes}m Early` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={d.status === 'PRESENT' ? 'good' : d.status === 'ABSENT' ? 'bad' : 'warn'}>
                        {d.status}
                      </Pill>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
