// apps/web/src/pages/hr/HrAttendancePage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox } from '../finance/shared';
import { getAttendanceDays, getShifts, type HrShift } from '../../lib/hrApi';

/** A clock time as the plant sees it (India time), whatever the browser's own time zone is. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const hours = (min: number) => `${(min / 60).toFixed(1)} hrs`;
const DAY_STATUS: Record<string, { label: string; tone: string }> = {
  P: { label: 'Present', tone: 'good' },
  A: { label: 'Absent', tone: 'bad' },
  HD: { label: 'Half day', tone: 'warn' },
  WO: { label: 'Weekly off', tone: 'warn' },
  H: { label: 'Holiday', tone: 'warn' },
  MIS: { label: 'Missed punch', tone: 'warn' },
};

export function HrAttendancePage() {
  const [month, setMonth] = useState('2027-02');
  const [days, setDays] = useState<any[]>([]);
  const [shifts, setShifts] = useState<HrShift[]>([]);
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

  useEffect(() => {
    getShifts()
      .then(setShifts)
      .catch((e: any) => setError(e.message || 'Failed to load shifts'));
  }, []);

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

      {/* Shifts */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 py-3 font-medium text-gray-800 border-b border-gray-200">Shifts</div>
        <table className="min-w-full divide-y divide-gray-200 text-sm" aria-label="Shifts">
          <thead className="bg-gray-50 text-gray-600 font-medium">
            <tr>
              <th className="px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Start</th>
              <th className="px-4 py-3 text-left">End</th>
              <th className="px-4 py-3 text-left">Break</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {shifts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">No shifts are set up.</td>
              </tr>
            ) : (
              shifts.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-mono text-gray-900">{s.code}</td>
                  <td className="px-4 py-3 text-gray-700">{s.name}{s.isNight ? ' (night)' : ''}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{s.startTime}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{s.endTime}{s.endTime <= s.startTime ? ' (next day)' : ''}</td>
                  <td className="px-4 py-3 text-gray-600">{s.breakMinutes} min</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
                  <tr key={d.id ?? `${d.employeeId}-${d.attendanceDate}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-900">{d.attendanceDate}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{d.empCode} - {d.employeeName}</td>
                    <td className="px-4 py-3 text-gray-600">{d.shiftCode || 'General'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{d.firstIn ? clock(d.firstIn) : '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{d.lastOut ? clock(d.lastOut) : '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{hours(Number(d.workedMinutes) || 0)}</td>
                    <td className="px-4 py-3 text-xs text-amber-600">
                      {d.lateMinutes ? `${d.lateMinutes}m Late` : ''} {d.earlyMinutes ? `${d.earlyMinutes}m Early` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={(DAY_STATUS[d.status] ?? { tone: 'warn' }).tone}>
                        {(DAY_STATUS[d.status] ?? { label: d.status }).label}
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
