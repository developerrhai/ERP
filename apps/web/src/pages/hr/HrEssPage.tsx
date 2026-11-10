// apps/web/src/pages/hr/HrEssPage.tsx
import { useEffect, useState } from 'react';
import { PageHead, Pill, ErrorBox } from '../finance/shared';
import { getEssDashboard, acceptPrivacyNotice } from '../../lib/hrApi';

export function HrEssPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getEssDashboard();
      setData(res);
    } catch (e: any) {
      setError(e.message || 'Failed to load ESS portal');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const handleAcceptPrivacy = async () => {
    try {
      if (data?.privacyNotice?.id) {
        await acceptPrivacyNotice(data.privacyNotice.id);
        alert('Privacy notice accepted.');
        loadDashboard();
      }
    } catch (e: any) {
      alert(e.message || 'Failed to record acceptance');
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading your self-service dashboard...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHead
        title="Employee Self-Service (ESS)"
        sub="Your Personal Workspace: Attendance, Leave, Claims & Privacy Notices"
      />

      <ErrorBox message={error} />

      {/* Privacy Notice Banner (DPDP requirement) */}
      {data?.privacyNotice && !data.privacyNotice.accepted && (
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg shadow-sm flex justify-between items-center">
          <div>
            <h4 className="font-semibold text-amber-900 text-sm">
              DPDP Act 2023 Notice ({data.privacyNotice.title} v{data.privacyNotice.version})
            </h4>
            <p className="text-xs text-amber-800 mt-1 max-w-2xl">{data.privacyNotice.summary}</p>
          </div>
          <button
            onClick={handleAcceptPrivacy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold whitespace-nowrap ml-4"
          >
            I Acknowledge & Accept
          </button>
        </div>
      )}

      {/* Profile Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xl">
            {data?.profile?.full_name?.slice(0, 2)?.toUpperCase() || 'ME'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{data?.profile?.full_name || 'Logged-in Employee'}</h2>
            <p className="text-sm text-gray-500">
              {data?.profile?.emp_code} • {data?.profile?.designation || 'Staff'} • {data?.profile?.department || 'General'}
            </p>
          </div>
        </div>
      </div>

      {/* Balances & Attendance Quick View */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Leave Balances */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm border-b pb-2">My Leave Balances</h3>
          <div className="grid grid-cols-3 gap-3">
            {data?.leaveBalances?.map((b: any) => (
              <div key={b.code} className="p-3 bg-gray-50 rounded border text-center">
                <span className="text-xs font-bold text-gray-500 uppercase">{b.code}</span>
                <p className="text-xl font-bold text-indigo-600 mt-1">{b.balance}</p>
                <span className="text-xs text-gray-400">{b.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Attendance */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm border-b pb-2">Recent Attendance</h3>
          <div className="divide-y text-xs">
            {data?.recentAttendance?.length === 0 ? (
              <p className="py-4 text-center text-gray-500">No attendance punches recorded this week.</p>
            ) : (
              data?.recentAttendance?.map((d: any) => (
                <div key={d.id} className="py-2 flex justify-between items-center">
                  <span className="font-mono text-gray-900">{d.work_date}</span>
                  <span className="text-gray-600">{d.work_minutes ? (d.work_minutes / 60).toFixed(1) + ' hrs' : '0 hrs'}</span>
                  <Pill tone={d.status === 'PRESENT' ? 'good' : 'warn'}>{d.status}</Pill>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
