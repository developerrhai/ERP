// Phase 21 §5.5 & §7: Dedicated `/install` device guide + chromium install prompt trigger + SW version info
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isIosDevice, isStandalonePwa } from '../../lib/pushClient';

export function InstallGuidePage() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(isStandalonePwa());

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installNow = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const res = await deferredPrompt.userChoice;
    if (res?.outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Install Sawant Group ERP App</h1>
          <p>Run Sawant ERP as a fast standalone desktop or mobile app with instant push alerts.</p>
        </div>
        <Link to="/m/notif-preferences" className="btn sm">
          Notification Settings
        </Link>
      </div>

      {installed ? (
        <div className="notice" role="status">
          Sawant Group ERP is already running in standalone app mode on this device.
        </div>
      ) : null}

      {deferredPrompt ? (
        <div className="card" style={{ padding: 16, borderLeft: '4px solid #0f766e' }}>
          <h3 style={{ marginTop: 0 }}>Ready to Install on This Device</h3>
          <p className="v8-sub">
            Your browser supports one-click installation with shortcuts for My Approvals, Notifications, QR Scan, and Gate Entry.
          </p>
          <button type="button" className="btn primary" onClick={() => void installNow()}>
            Install Sawant ERP
          </button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Android (Chrome / Edge)</h3>
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Open this site in Chrome on Android.</li>
            <li>Tap the browser menu (three dots) &rarr; <strong>Install app</strong> (or tap the banner).</li>
            <li>Open <strong>Sawant ERP</strong> from your Home Screen and allow Notifications when prompted.</li>
          </ol>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            iPhone &amp; iPad (Safari 16.4+) {isIosDevice() ? '— Recommended for your device' : ''}
          </h3>
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Open this URL in <strong>Safari</strong> (iOS requires Home Screen installation for Web Push).</li>
            <li>Tap the <strong>Share</strong> icon (square with upward arrow) at the bottom bar.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Launch <strong>Sawant ERP</strong> from your Home Screen, then visit Notification Settings to enable Push.</li>
          </ol>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Windows / Mac Desktop</h3>
          <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Open in Chrome or Edge.</li>
            <li>Click the <strong>Install icon</strong> in the right side of the address bar.</li>
            <li>Pin to Taskbar or Dock for instant one-click access.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

