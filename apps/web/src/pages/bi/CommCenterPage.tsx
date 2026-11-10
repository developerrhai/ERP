// apps/web/src/pages/bi/CommCenterPage.tsx
import { useEffect, useState } from 'react';
import { biApi } from '../../lib/biApi';
import { phase21Api } from '../../lib/phase21Api';

export function CommCenterPage({
  initialTab,
}: {
  initialTab?: 'TEMPLATES' | 'LOGS' | 'CONSENTS' | 'PAYMENT';
}) {
  const [tab, setTab] = useState<'TEMPLATES' | 'LOGS' | 'CONSENTS' | 'PAYMENT'>(initialTab ?? 'TEMPLATES');
  const [templates, setTemplates] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [consents, setConsents] = useState<any[]>([]);
  const [paymentLinks, setPaymentLinks] = useState<any[]>([]);
  const [payAmount, setPayAmount] = useState('15000');

  const loadAll = async () => {
    try {
      const [t, m, c, p] = await Promise.all([
        biApi.listTemplates(),
        biApi.listMessages(),
        biApi.listConsents(),
        biApi.listPaymentLinks(),
      ]);
      setTemplates(t);
      setMessages(m);
      setConsents(c);
      setPaymentLinks(p);
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">💬 Communication & Razorpay Payment Links</h1>
          <p className="text-sm text-slate-500">
            WhatsApp Cloud API, TRAI DLT SMS validation, Opt-in Consents & Payment Links (Test Mode)
          </p>
        </div>
        <div className="flex gap-1.5">
          {([
            ['TEMPLATES', 'Templates (DLT / WA)'],
            ['LOGS', 'Message Logs'],
            ['CONSENTS', 'Consents'],
            ['PAYMENT', 'Payment Links'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                tab === key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'TEMPLATES' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Channel</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Regulatory Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{t.code}</td>
                  <td className="px-4 py-3 text-xs">{t.channel}</td>
                  <td className="px-4 py-3">{t.name}</td>
                  <td className="px-4 py-3 text-xs font-mono">
                    {t.channel === 'SMS' ? `DLT: ${t.dltTemplateId || 'MISSING'}` : `Meta WA: ${t.waStatus}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'LOGS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Channel</th>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Reason / Error</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-xs">{m.channel}</td>
                  <td className="px-4 py-3 font-mono text-xs">{m.recipient}</td>
                  <td className="px-4 py-3 text-xs font-semibold">{m.status}</td>
                  <td className="px-4 py-3 text-xs text-red-700">{m.error || '-'}</td>
                  <td className="px-4 py-3 text-xs">
                    {m.channel === 'EMAIL' && m.doc_id ? (
                      <button
                        type="button"
                        className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                        onClick={async () => {
                          const reason = window.prompt('Reason for resend (min 5 chars):', 'Updated customer contact');
                          if (!reason || reason.trim().length < 5) return;
                          const toInput = window.prompt('Send to (blank = keep existing):', '');
                          await phase21Api.resendCommMessage(m.id, {
                            reason: reason.trim(),
                            ...(toInput?.trim() ? { to: [toInput.trim()] } : {}),
                          });
                          await loadAll();
                        }}
                      >
                        Resend
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'CONSENTS' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">Channel</th>
                <th className="px-4 py-3 text-left">Address</th>
                <th className="px-4 py-3 text-left">Opted In</th>
                <th className="px-4 py-3 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {consents.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-xs">{c.channel}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.address}</td>
                  <td className="px-4 py-3 text-xs">{c.optedIn ? 'Yes' : 'Opted Out'}</td>
                  <td className="px-4 py-3 text-xs">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'PAYMENT' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-2 items-center max-w-md">
            <input
              type="number"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            />
            <button
              onClick={async () => {
                await biApi.createPaymentLink({ amount: Number(payAmount) });
                await loadAll();
              }}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium"
            >
              Generate Test Link
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">Link ID</th>
                  <th className="px-4 py-3 text-left">Short URL</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentLinks.map((pl) => (
                  <tr key={pl.id}>
                    <td className="px-4 py-3 font-mono text-xs">{pl.linkId}</td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-600">{pl.shortUrl}</td>
                    <td className="px-4 py-3 text-right font-mono">₹{Number(pl.amount).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-xs font-semibold">{pl.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

