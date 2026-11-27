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
      toast(t('dpdp.acknowledged'));
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not acknowledge privacy notice.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop x-pos-fixed x-inset-0 x-bg-rgba-15-23-42-0_6 x-d-grid x-place-items-center x-z-index-1000 x-p-16px"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dpdp-notice-title"
    >
      <div
        className="card x-bg-card x-r-14px x-maxw-640px x-w-100pct x-p-20px x-box-shadow-shadow"
      >
        <div className="x-d-flex x-jc-space-between x-ai-center x-gap-8px">
          <h2 id="dpdp-notice-title" className="x-m-0 x-fs-18px">
            {notice.localizedTitle}
          </h2>
          <div className="x-d-flex x-gap-4px">
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
        <div className="x-ws-pre-line x-mt-12px x-fs-14px x-lh-1_5">
          {notice.localizedTextMd}
        </div>
        <div
          className="x-mt-14px x-p-10px x-r-8px x-bg-card2 x-bd-1px-solid-line x-fs-13px"
        >
          <strong>{t('dpdp.grievanceOfficer')}:</strong> {notice.grievanceOfficerName} ·{' '}
          {notice.grievanceOfficerEmail} · {notice.grievanceOfficerPhone}
        </div>
        <div className="x-d-flex x-jc-flex-end x-gap-8px x-mt-16px">
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

