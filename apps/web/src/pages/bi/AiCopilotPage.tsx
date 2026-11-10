// apps/web/src/pages/bi/AiCopilotPage.tsx
import { useEffect, useState } from 'react';
import { biApi } from '../../lib/biApi';

export function AiCopilotPage({
  pageId,
  initialTab,
}: {
  pageId?: string;
  initialTab?: 'COPILOT' | 'FORECAST' | 'INSIGHTS' | 'SETTINGS';
}) {
  if (pageId === 'ai-sales' || pageId === 'ai-vendor') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
        <h2 className="text-lg font-bold text-slate-800">{pageId} — Coming in v1.1</h2>
        <p className="text-sm text-slate-500">
          Metrics for this area are live inside BI Sales & BI Purchase tiles. Full standalone AI view arrives in v1.1.
        </p>
      </div>
    );
  }

  const [tab, setTab] = useState<'COPILOT' | 'FORECAST' | 'INSIGHTS' | 'SETTINGS'>(initialTab ?? 'COPILOT');
  const [settings, setSettings] = useState<any | null>(null);
  const [usage, setUsage] = useState<any | null>(null);
  const [convId, setConvId] = useState<string>('');
  const [messages, setMessages] = useState<any[]>([]);
  const [question, setQuestion] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forecasting
  const [seriesText, setSeriesText] = useState('100, 108, 112, 121, 125, 132');
  const [method, setMethod] = useState<'HOLT' | 'SES' | 'MA'>('HOLT');
  const [forecastRes, setForecastRes] = useState<any | null>(null);
  const [insights, setInsights] = useState<any[]>([]);

  const loadAll = async () => {
    try {
      const [s, u, ins] = await Promise.all([
        biApi.getAiSettings(),
        biApi.getAiUsage(),
        biApi.listInsights(),
      ]);
      setSettings(s);
      setUsage(u);
      setInsights(ins);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!question.trim()) return;
    try {
      let cId = convId;
      if (!cId) {
        const conv = await biApi.createConversation({ title: question.slice(0, 50) });
        cId = conv.id;
        setConvId(cId);
      }
      await biApi.askCopilot(cId, question);
      const msgs = await biApi.getConversationMessages(cId);
      setMessages(msgs);
      setQuestion('');
      await loadAll();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Copilot unavailable');
    }
  };

  const handleRunForecast = async () => {
    setErrorMsg(null);
    try {
      const nums = seriesText
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => !Number.isNaN(n));
      const res = await biApi.runForecast({
        subject: 'ITEM_DEMAND',
        subjectId: 'DEMO-SKU',
        method,
        series: nums,
        horizon: 3,
      });
      setForecastRes(res);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Forecast failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">🤖 ERP Decision Center & AI Copilot</h1>
          <p className="text-sm text-slate-500">
            Permission-scoped tool use, OWASP LLM protections, deterministic Holt/SES forecasting & Z-score insights
          </p>
        </div>
        <div className="flex gap-1.5">
          {([
            ['COPILOT', 'Copilot Chat'],
            ['FORECAST', 'Statistical Forecast'],
            ['INSIGHTS', 'Anomaly Insights'],
            ['SETTINGS', 'AI Settings & Budget'],
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

      {settings && !settings.enabled && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>AI is off — Admin can enable it in AI Settings. Deterministic statistical forecasts and insights remain available.</span>
          <button
            onClick={() => setTab('SETTINGS')}
            className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium"
          >
            Open AI Settings
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-2.5 rounded-lg text-sm">{errorMsg}</div>
      )}

      {tab === 'COPILOT' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 border-b pb-2">
            <span>Read-only tool scope • Citations verified per-record</span>
            {usage && (
              <span className="font-mono">
                Today usage: ₹{Number(usage.userCostInr).toFixed(2)} ({usage.userTokens} tokens)
              </span>
            )}
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`p-3 rounded-lg text-sm ${
                  m.role === 'user' ? 'bg-indigo-50 text-indigo-900 ml-12' : 'bg-slate-50 text-slate-800 mr-12 border border-slate-200'
                }`}
              >
                <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">{m.role}</div>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {Array.isArray(m.citations) && m.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.citations.map((cid: string) => (
                      <span key={cid} className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[11px] font-mono">
                        Citation: {cid.slice(0, 8)}…
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={handleAsk} className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask e.g. 'Top 5 overdue invoices in my unit'..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
              Ask Copilot
            </button>
          </form>
        </div>
      )}

      {tab === 'FORECAST' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs text-slate-600 mb-1">Historical Series (comma-separated, min 6 periods)</label>
              <input
                value={seriesText}
                onChange={(e) => setSeriesText(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as any)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="HOLT">Holt Double Exponential</option>
                <option value="SES">Simple Exponential (SES)</option>
                <option value="MA">Moving Average (MA)</option>
              </select>
            </div>
            <button onClick={handleRunForecast} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
              Run Statistical Forecast
            </button>
          </div>

          {forecastRes && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-indigo-700">{forecastRes.label}</span>
                <span className="text-xs font-mono text-slate-500">MAPE: {forecastRes.mape}% • RMSE: {forecastRes.rmse}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(Array.isArray(forecastRes.output) ? forecastRes.output : []).map((pt: any) => (
                  <div key={pt.periodIndex} className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-xs text-slate-500">Period +{pt.periodIndex} (Estimate)</div>
                    <div className="text-lg font-bold font-mono text-slate-900">{pt.estimate}</div>
                    <div className="text-[11px] font-mono text-slate-500">95% Band: [{pt.lo} .. {pt.hi}]</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'INSIGHTS' && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {insights.length === 0 ? (
            <div className="p-6 text-sm text-slate-500 text-center">No Z-score anomalies detected in current window.</div>
          ) : (
            insights.map((i) => (
              <div key={i.id} className="p-4 flex items-center justify-between">
                <div>
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-bold mr-2">{i.severity}</span>
                  <span className="text-sm font-medium text-slate-900">{i.message}</span>
                </div>
                <span className="text-xs font-mono text-slate-500">z={i.score}</span>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'SETTINGS' && settings && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 max-w-lg">
          <h3 className="font-bold text-slate-800">Single-Row AI Control Settings (ERRATA E-18)</h3>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={Boolean(settings.enabled)}
              onChange={async (e) => {
                const updated = await biApi.updateAiSettings({ enabled: e.target.checked });
                setSettings(updated);
              }}
            />
            Enable AI Copilot across ERP
          </label>
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
            <div>Analysis Model: <strong className="font-mono">{settings.analysisModel}</strong></div>
            <div>Classify Model: <strong className="font-mono">{settings.classifyModel}</strong></div>
            <div>Org Daily Cap: <strong className="font-mono">₹{settings.orgDailyInrCap}</strong></div>
            <div>User Daily Cap: <strong className="font-mono">₹{settings.userDailyInrCap}</strong></div>
          </div>
        </div>
      )}
    </div>
  );
}

