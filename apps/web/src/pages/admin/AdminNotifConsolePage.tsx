// Phase 21 §7 Admin Notification Control, Broadcast Composer/Reports, Email Rules, Suppressions & Health Console
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { phase21Api } from '../../lib/phase21Api';
import { SW_VERSION } from '../../sw';

type Tab = 'TYPES' | 'BROADCASTS' | 'EMAIL_RULES' | 'SUPPRESSIONS' | 'HEALTH';

export function AdminNotifConsolePage({ initialTab = 'TYPES' }: { initialTab?: Tab }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [types, setTypes] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [suppressions, setSuppressions] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);

  // Broadcast composer state
  const [bTitle, setBTitle] = useState('');
  const [bBody, setBBody] = useState('');
  const [bSeverity, setBSeverity] = useState<'INFO' | 'WARNING' | 'CRITICAL'>('INFO');
  const [bAll, setBAll] = useState(true);
  const [bUnits, setBUnits] = useState('');
  const [bPin, setBPin] = useState(true);
  const [bAck, setBAck] = useState(false);
  const [bEmergency, setBEmergency] = useState(false);
  const [bReason, setBReason] = useState('');
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<any>(null);

  // Suppressions quick add
  const [supEmail, setSupEmail] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadTab = useCallback(async () => {
    if (tab === 'TYPES') {
      const [t, s] = await Promise.all([phase21Api.listAdminTypes(), phase21Api.getAdminSettings()]);
      setTypes(t);
      setSettings(s);
    } else if (tab === 'BROADCASTS') {
      setBroadcasts(await phase21Api.listBroadcasts());
    } else if (tab === 'EMAIL_RULES') {
      setRules(await phase21Api.listEmailRules());
    } else if (tab === 'SUPPRESSIONS') {
      setSuppressions(await phase21Api.listSuppressions());
    } else if (tab === 'HEALTH') {
      setHealth(await phase21Api.getHealth());
    }
  }, [tab]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  const previewAudience = async () => {
    const unitIds = bAll ? undefined : bUnits.split(',').map((s) => s.trim()).filter(Boolean);
    const res = await phase21Api.previewAudience(bAll ? { all: true } : { unitIds });
    setAudienceCount(res.count);
  };

  const createAndSubmitBroadcast = async () => {
    try {
      const unitIds = bAll ? undefined : bUnits.split(',').map((s) => s.trim()).filter(Boolean);
      const draft = await phase21Api.createBroadcast({
        title: bTitle,
        bodyMd: bBody,
        severity: bSeverity,
        audience: bAll ? { all: true } : { unitIds },
        channels: bEmergency ? ['IN_APP', 'PUSH'] : ['IN_APP', 'PUSH'],
        pinBanner: bPin,
        requireAck: bAck,
        emergency: bEmergency,
        reason: bReason || undefined,
      });
      await phase21Api.submitBroadcast(draft.id);
      setBTitle('');
      setBBody('');
      setBReason('');
      setBEmergency(false);
      toast('Broadcast submitted.');
      await loadTab();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Broadcast submit failed.');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Notification &amp; Email Control</h1>
          <p>Manage alert channels, kill switches, broadcasts, email automation rules, suppressions &amp; SES health.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['TYPES', 'Types & Switches'],
            ['BROADCASTS', 'Broadcasts'],
            ['EMAIL_RULES', 'Email Rules'],
            ['SUPPRESSIONS', 'Suppressions'],
            ['HEALTH', 'Delivery Health'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'tab active' : 'tab'}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'TYPES' ? (
        <>
          {settings ? (
            <section className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Global Channel Switches</h3>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void phase21Api.resetAdminSettings().then((s) => {
                      setSettings(s);
                      toast('System defaults restored.');
                    })
                  }
                >
                  Reset Defaults
                </button>
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={settings.emailEnabled}
                    onChange={(e) =>
                      void phase21Api
                        .updateAdminSettings({ emailEnabled: e.target.checked })
                        .then(setSettings)
                    }
                  />
                  Email Enabled
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={settings.pushEnabled}
                    onChange={(e) =>
                      void phase21Api
                        .updateAdminSettings({ pushEnabled: e.target.checked })
                        .then(setSettings)
                    }
                  />
                  Web Push Enabled
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={settings.smsEnabled}
                    onChange={(e) =>
                      void phase21Api
                        .updateAdminSettings({ smsEnabled: e.target.checked })
                        .then(setSettings)
                    }
                  />
                  SMS Enabled
                </label>
                <span>
                  Quiet Window: <strong>{settings.quietStart}–{settings.quietEnd} IST</strong>
                </span>
                <span>
                  Approval Threshold: <strong>{settings.broadcastApprovalThresholdUsers} users</strong>
                </span>
              </div>
            </section>
          ) : null}

          <section className="card" style={{ padding: 16, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Enabled</th>
                  <th>Test</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.code}>
                    <td>
                      <strong>{t.label}</strong>
                      <div className="v8-sub">{t.code} ({t.module})</div>
                    </td>
                    <td>{t.category}</td>
                    <td>{t.priority}</td>
                    <td>
                      {t.category === 'SECURITY' ? (
                        <span title="Security alerts cannot be disabled">🔒 Always On</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          onChange={(e) =>
                            void phase21Api
                              .updateAdminType(t.code, { enabled: e.target.checked })
                              .then(() => loadTab())
                          }
                        />
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          void phase21Api
                            .testAdminType(t.code)
                            .then(() => toast(`Sample ${t.code} sent to you.`))
                        }
                      >
                        Send Test
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {tab === 'BROADCASTS' ? (
        <>
          <section className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>New Broadcast Announcement</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <label>
                Title
                <input value={bTitle} onChange={(e) => setBTitle(e.target.value)} maxLength={120} />
              </label>
              <label>
                Severity
                <select value={bSeverity} onChange={(e) => setBSeverity(e.target.value as any)}>
                  <option value="INFO">INFO</option>
                  <option value="WARNING">WARNING</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </label>
            </div>
            <label>
              Message
              <textarea rows={3} value={bBody} onChange={(e) => setBBody(e.target.value)} maxLength={4000} />
            </label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={bAll} onChange={(e) => setBAll(e.target.checked)} />
                All Active Staff
              </label>
              {!bAll ? (
                <input
                  placeholder="Unit UUIDs (comma-separated)"
                  value={bUnits}
                  onChange={(e) => setBUnits(e.target.value)}
                />
              ) : null}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={bPin} onChange={(e) => setBPin(e.target.checked)} />
                Pin Banner
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={bAck} onChange={(e) => setBAck(e.target.checked)} />
                Require Ack Modal
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={bEmergency} onChange={(e) => setBEmergency(e.target.checked)} />
                Emergency Bypass (Super User / Admin only)
              </label>
            </div>
            {bEmergency ? (
              <label>
                Mandatory Emergency Reason (audited)
                <input
                  value={bReason}
                  onChange={(e) => setBReason(e.target.value)}
                  placeholder="e.g. Transformer outage at Talegaon Unit"
                />
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn sm" onClick={() => void previewAudience()}>
                Preview Audience
              </button>
              {audienceCount !== null ? <span>This will reach <strong>{audienceCount}</strong> active users.</span> : null}
              <button
                type="button"
                className="btn primary sm"
                disabled={!bTitle.trim() || !bBody.trim()}
                onClick={() => void createAndSubmitBroadcast()}
              >
                Create &amp; Submit
              </button>
            </div>
          </section>

          <section className="card" style={{ padding: 16, overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Severity</th>
                  <th>Recipients</th>
                  <th>Read / Acked</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((b) => (
                  <tr key={b.id}>
                    <td>{b.number}</td>
                    <td>{b.title}</td>
                    <td><span className="tag">{b.status}</span></td>
                    <td>{b.severity}</td>
                    <td>{b.recipient_count}</td>
                    <td>{b.read_count} / {b.acked_count}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {b.status === 'PENDING_APPROVAL' ? (
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={() =>
                            void phase21Api
                              .approveBroadcast(b.id)
                              .then(() => loadTab())
                              .catch((e) => toast(e.message))
                          }
                        >
                          Approve
                        </button>
                      ) : null}
                      {b.status === 'SENT' ? (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => void phase21Api.getBroadcastReport(b.id).then(setSelectedReport)}
                          >
                            Report
                          </button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() =>
                              void phase21Api
                                .withdrawBroadcast(b.id, 'Withdrawn by admin')
                                .then(() => loadTab())
                            }
                          >
                            Withdraw
                          </button>
                        </>
                      ) : null}
                      {['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED'].includes(b.status) ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => void phase21Api.cancelBroadcast(b.id).then(() => loadTab())}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selectedReport ? (
              <div className="notice" style={{ marginTop: 12 }}>
                <strong>Report {selectedReport.broadcast.number}:</strong> Delivered {selectedReport.totals.delivered},
                Read {selectedReport.totals.read}, Acked {selectedReport.totals.acked}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {tab === 'EMAIL_RULES' ? (
        <section className="card" style={{ padding: 16, overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Event</th>
                <th>Attachment</th>
                <th>Mode</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.code}</code></td>
                  <td>{r.name}</td>
                  <td>{r.event_code}</td>
                  <td>{r.attachment} ({r.attach_mode})</td>
                  <td>{r.send_mode}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) =>
                        void phase21Api.updateEmailRule(r.id, { enabled: e.target.checked }).then(() => loadTab())
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'SUPPRESSIONS' ? (
        <section className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="email"
              placeholder="address@example.com"
              value={supEmail}
              onChange={(e) => setSupEmail(e.target.value)}
            />
            <button
              type="button"
              className="btn sm primary"
              onClick={() =>
                void phase21Api
                  .addSuppression(supEmail, 'MANUAL')
                  .then(() => {
                    setSupEmail('');
                    void loadTab();
                  })
              }
            >
              Suppress Address
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Reason</th>
                <th>Added</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {suppressions.map((s) => (
                <tr key={s.email_norm}>
                  <td>{s.email_norm}</td>
                  <td>{s.reason}</td>
                  <td>{new Date(s.added_at).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        void phase21Api
                          .removeSuppression(s.email_norm, 'Unblocked via admin console')
                          .then(() => loadTab())
                      }
                    >
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === 'HEALTH' && health ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <small>Live SSE Streams</small>
            <h2 style={{ margin: '6px 0' }}>{health.sseActiveStreams}</h2>
            <small>SW Version: v{SW_VERSION}</small>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <small>Web Push Devices / 24h Sent</small>
            <h2 style={{ margin: '6px 0' }}>{health.push.activeDevices} / {health.push.sent24h}</h2>
            <small>Revoked 24h: {health.push.revoked24h}</small>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <small>Email 24h (Sent / Delivered / Bounces)</small>
            <h2 style={{ margin: '6px 0' }}>
              {health.email.sent24h} / {health.email.delivered24h} / {health.email.bounces24h}
            </h2>
            <small>Complaint rate: {health.email.complaintRatePct}%</small>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <small>Domain Auth ({health.email.domain.domain})</small>
            <h2 style={{ margin: '6px 0' }}>
              {health.email.domain.configured ? (health.email.domain.dkimVerified ? 'DKIM OK' : 'Pending DNS') : 'Local/SMTP'}
            </h2>
            <small>Suppressions active: {health.email.suppressionsActive}</small>
          </div>
        </div>
      ) : null}
    </div>
  );
}

