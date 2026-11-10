// Phase 20-J: DPDP Privacy Notice modal (English / Hindi / Marathi) shown on first login or from footer/drawer.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hardeningApi, type PrivacyNoticeDto } from '../lib/hardeningApi';
import { useToast } from './Toast';

interface PrivacyNoticeModalProps {
  open: boolean;
  onClose: () => void;
  forceOnUnaccepted?: boolean;
}

export function PrivacyNoticeModal({ open, onClose, forceOnUnaccepted }: PrivacyNoticeModalProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [noticeLocale, setNoticeLocale] = useState<'en' | 'hi' | 'mr'>(
    i18n.language === 'hi' ? 'hi' : 'en',
  );
  const [notice, setNotice] = useState<PrivacyNoticeDto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!open && !forceOnUnaccepted) return;
    hardeningApi
      .getPrivacyNotice(noticeLocale)
      .then((res) => {
        if (alive) setNotice(res);
      })
      .catch(() => {
        // Offline or degraded DB should not block rendering shell
      });
    return () => {
      alive = false;
    };
  }, [open, forceOnUnaccepted, noticeLocale]);

  const shouldRender = open || (Boolean(forceOnUnaccepted) && Boolean(notice && !notice.accepted));
  if (!shouldRender || !notice) return null;

  const accept = async () => {
    setBusy(true);
    try {
      await hardeningApi.acknowledgePrivacy(notice.id);
      setNotice({ ...notice, accepted: true });
      toast(t('dpdp.acknowledge'));
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not acknowledge privacy notice.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dpdp-notice-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          background: '#fff',
          borderRadius: 14,
          maxWidth: 640,
          width: '100%',
          padding: 20,
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 id="dpdp-notice-title" style={{ margin: 0, fontSize: 18 }}>
            {notice.localizedTitle}
          </h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['en', 'hi', 'mr'] as const).map((loc) => (
              <button
                key={loc}
                type="button"
                className={`btn ${noticeLocale === loc ? 'primary' : ''}`}
                onClick={() => setNoticeLocale(loc)}
              >
                {loc === 'en' ? 'EN' : loc === 'hi' ? 'हिन्दी' : 'मराठी'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ whiteSpace: 'pre-line', marginTop: 12, fontSize: 14, lineHeight: 1.5 }}>
          {notice.localizedTextMd}
        </div>
        <div
          style={{
            marginTop: 14,
            padding: 10,
            borderRadius: 8,
            background: 'var(--card2)',
            border: '1px solid var(--line)',
            fontSize: 13,
          }}
        >
          <strong>{t('dpdp.grievanceOfficer')}:</strong> {notice.grievanceOfficerName} ·{' '}
          {notice.grievanceOfficerEmail} · {notice.grievanceOfficerPhone}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {notice.accepted || !forceOnUnaccepted ? (
            <button type="button" className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
          ) : null}
          {!notice.accepted ? (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void accept()}>
              {t('dpdp.acknowledge')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

