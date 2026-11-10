// Phase 21 §5.4/§5.5/§7: Notification Preferences + Soft-Ask Push Card + Device Management + Quiet Hours
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { phase21Api, type NotifyChannel, type UserPrefRow } from '../../lib/phase21Api';
import {
  enableBrowserPush,
  isIosSafariNotInstalled,
  pushSupported,
} from '../../lib/pushClient';

export function NotificationPrefsPage() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<UserPrefRow[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [softAskDismissed, setSoftAskDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, d] = await Promise.all([
        phase21Api.getMyPrefs(),
        phase21Api.getMySettings(),
        phase21Api.listMyDevices(),
      ]);
      setPrefs(p);
      setQuietStart(s.quietStart);
      setQuietEnd(s.quietEnd);
      setDigestEnabled(s.digestEnabled);
      setLanguage(s.language);
      setSoftAskDismissed(Boolean(s.softAskDismissedAt));
      setDevices(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEnablePush = async () => {
    setPushBusy(true);
    try {
      const res = await enableBrowserPush();
      if (res.ok) {
        toast('Push alerts enabled on this device.');
        await load();
      } else {
        toast(res.reason || 'Could not enable push notifications.');
      }
    } finally {
      setPushBusy(false);
    }
  };

  const togglePref = async (row: UserPrefRow, channel: NotifyChannel, enabled: boolean, mode?: 'IMMEDIATE' | 'DIGEST') => {
    const ch = row.channels[channel];
    if (ch.mandatory && !enabled) {
      toast(`${channel} notifications for ${row.label} cannot be disabled.`);
      return;
    }
    try {
      const updated = await phase21Api.saveMyPrefs([
        {
          typeCode: row.code,
          channel,
          enabled,
          mode: mode ?? ch.mode,
        },
      ]);
      setPrefs(updated);
      toast('Saved preference.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const saveQuietHours = async () => {
    try {
      await phase21Api.saveMySettings({ quietStart, quietEnd, digestEnabled, language });
      toast('Quiet hours & notification settings saved.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save settings.');
    }
  };

  const renameDevice = async (id: string, currentLabel: string) => {
    const next = window.prompt('Device label', currentLabel);
    if (!next?.trim()) return;
    await phase21Api.renameDevice(id, next.trim());
    await load();
  };

  const revokeDevice = async (id: string) => {
    await phase21Api.revokeDevice(id);
    toast('Device removed.');
    await load();
  };

  const testPush = async () => {
    const res = await phase21Api.sendTestPush();
    toast(`Test push dispatched (sent: ${res.sent}, revoked: ${res.revoked}).`);
  };

  if (loading) return <p className="v8-sub">Loading notification preferences…</p>;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Notification Preferences</h1>
          <p>Choose how and when Sawant ERP alerts reach your devices.</p>
        </div>
        <Link to="/install" className="btn sm">
          Install App Guide
        </Link>
      </div>

      {/* Soft-ask card (never auto-prompts browser dialog before user click) */}
      {!softAskDismissed && devices.length === 0 ? (
        <div className="card" style={{ padding: 16, borderLeft: '4px solid #0f766e' }}>
          <h3 style={{ marginTop: 0 }}>Enable instant approval &amp; breakdown alerts</h3>
          {isIosSafariNotInstalled() ? (
            <p className="v8-sub">
              On iPhone / iPad Safari: tap the <strong>Share</strong> icon in Safari and choose{' '}
              <strong>Add to Home Screen</strong>, then open Sawant ERP from your Home Screen to enable push alerts.
            </p>
          ) : (
            <p className="v8-sub">
              Get immediate desktop/mobile push notifications when an invoice, PO, or P1 machine breakdown waits on your action.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {!isIosSafariNotInstalled() ? (
              <button
                type="button"
                className="btn primary sm"
                disabled={pushBusy || !pushSupported()}
                onClick={() => void handleEnablePush()}
              >
                {pushBusy ? 'Enabling…' : 'Enable push notifications'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setSoftAskDismissed(true);
                void phase21Api.saveMySettings({ dismissSoftAsk: true });
              }}
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {/* Registered Devices & Quiet Hours */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <section className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Registered Devices</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn sm" disabled={pushBusy} onClick={() => void handleEnablePush()}>
                + Add This Device
              </button>
              <button type="button" className="btn sm" onClick={() => void testPush()}>
                Test Push
              </button>
            </div>
          </div>
          {devices.length === 0 ? (
            <p className="v8-sub" style={{ marginTop: 10 }}>
              No push-enabled browsers/devices registered yet.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 8 }}>
              {devices.map((d) => (
                <li
                  key={d.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <div>
                    <strong>{d.device_label}</strong>
                    <div className="v8-sub">
                      {d.platform} · {d.browser} {d.standalone ? '· Installed PWA' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn sm" onClick={() => void renameDevice(d.id, d.device_label)}>
                      Rename
                    </button>
                    <button type="button" className="btn sm danger" onClick={() => void revokeDevice(d.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Quiet Hours &amp; Digest (IST)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>
              Quiet Start
              <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
            </label>
            <label>
              Quiet End
              <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
            </label>
            <label>
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'hi')}>
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input
                type="checkbox"
                checked={digestEnabled}
                onChange={(e) => setDigestEnabled(e.target.checked)}
              />
              Daily Email Digest
            </label>
          </div>
          <p className="v8-sub" style={{ marginTop: 8 }}>
            Non-urgent push/SMS alerts wait until Quiet Hours end. URGENT security and P1 breakdown alerts always deliver immediately.
          </p>
          <button type="button" className="btn primary sm" onClick={() => void saveQuietHours()}>
            Save Quiet Settings
          </button>
        </section>
      </div>

      {/* Per-Type Channel Matrix */}
      <section className="card" style={{ padding: 16, overflowX: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Notification Matrix (38 Event Types)</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Module</th>
              <th>Priority</th>
              <th>In-App</th>
              <th>Push</th>
              <th>Email</th>
              <th>SMS</th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((row) => (
              <tr key={row.code}>
                <td>
                  <strong>{row.label}</strong>
                  <div className="v8-sub">{row.code}</div>
                </td>
                <td>{row.module}</td>
                <td>
                  <span className="tag">{row.priority}</span>
                </td>
                <td>
                  {row.channels.IN_APP.mandatory ? (
                    <span title="In-app mandatory">🔒 Always</span>
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`${row.label} In-app`}
                      checked={row.channels.IN_APP.enabled}
                      onChange={(e) => void togglePref(row, 'IN_APP', e.target.checked)}
                    />
                  )}
                </td>
                <td>
                  {!row.channels.PUSH.allowed ? (
                    '—'
                  ) : row.channels.PUSH.mandatory ? (
                    <span title="Mandatory">🔒 On</span>
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`${row.label} Push`}
                      checked={row.channels.PUSH.enabled}
                      onChange={(e) => void togglePref(row, 'PUSH', e.target.checked)}
                    />
                  )}
                </td>
                <td>
                  {!row.channels.EMAIL.allowed ? (
                    '—'
                  ) : row.channels.EMAIL.mandatory ? (
                    <span title="Mandatory">🔒 Instant</span>
                  ) : (
                    <select
                      aria-label={`${row.label} Email`}
                      value={
                        !row.channels.EMAIL.enabled
                          ? 'OFF'
                          : row.channels.EMAIL.mode === 'DIGEST'
                            ? 'DIGEST'
                            : 'IMMEDIATE'
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'OFF') void togglePref(row, 'EMAIL', false);
                        else void togglePref(row, 'EMAIL', true, v as 'IMMEDIATE' | 'DIGEST');
                      }}
                    >
                      <option value="IMMEDIATE">Instant</option>
                      {row.digestAllowed ? <option value="DIGEST">Daily Digest</option> : null}
                      <option value="OFF">Off</option>
                    </select>
                  )}
                </td>
                <td>
                  {!row.channels.SMS.allowed ? (
                    '—'
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`${row.label} SMS`}
                      checked={row.channels.SMS.enabled}
                      onChange={(e) => void togglePref(row, 'SMS', e.target.checked)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

