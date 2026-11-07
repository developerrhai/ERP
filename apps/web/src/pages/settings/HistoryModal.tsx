// Version history of one format / rule set, with "Restore as new version" (history is never rewritten).
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Modal } from '../../components/Modal';
import { toUiError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { formatVersions, restore, ruleVersions, type SettingsVersion } from '../../lib/settingsApi';
import { useLoad } from '../../lib/useLoad';
import { statusClass, statusLabel } from './shared';

interface Props {
  pageId: string;
  part: 'formats' | 'rules';
  row: SettingsVersion;
  canEdit: boolean;
  onClose: () => void;
  onRestored: () => void;
}

export function HistoryModal({ pageId, part, row, canEdit, onClose, onRestored }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const versions = useLoad<SettingsVersion[]>(
    () =>
      part === 'formats' && row.kind
        ? formatVersions(pageId, {
            kind: row.kind,
            customerId: row.customer?.id ?? null,
            unitId: row.unit?.id ?? null,
          })
        : ruleVersions(pageId, row.code ?? ''),
    [pageId, row.id],
  );

  const onRestore = async (v: SettingsVersion): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await restore(pageId, part, v);
      onRestored();
    } catch (err) {
      setError(toUiError(err).message);
    }
    setBusy(false);
  };

  return (
    <Modal
      title={`History — ${row.name}`}
      sub="Every published version is kept. Old documents keep the version they were created with."
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {versions.error ? (
        <ErrorMessage onReload={versions.reload}>{versions.error}</ErrorMessage>
      ) : null}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Changed by</th>
              <th scope="col">When</th>
              <th scope="col">Reason</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.data?.map((v) => (
              <tr key={v.id}>
                <td>v{v.versionNo}</td>
                <td>
                  <span className={`status ${statusClass(v.status)}`}>{statusLabel(v.status)}</span>
                </td>
                <td>{(v.publishedBy ?? v.createdBy)?.name ?? '—'}</td>
                <td>{formatDateTime(v.publishedAt ?? v.createdAt)}</td>
                <td>{v.reason ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={
                      !canEdit || busy || v.status === 'DRAFT' || v.status === 'PENDING_APPROVAL'
                    }
                    title={canEdit ? undefined : 'Only the Department Head can change this'}
                    aria-label={`Restore v${v.versionNo} as new version`}
                    onClick={() => void onRestore(v)}
                  >
                    Restore as new version
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
