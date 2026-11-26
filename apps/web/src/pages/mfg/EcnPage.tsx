// Phase 42: Engineering Change Order register. Read-only - a row is raised automatically when a released BOM
// is revised (see "New revision" on the Bill of Materials page); there is nothing to add or edit here.
import { mlist } from '../../lib/mfgApi';
import { useLoad } from '../../lib/useLoad';
import type { ActionSet } from '../../types';
import { s } from '../qms/Shared';
import { ErrorBox, PageHead } from '../finance/shared';
import { Grid } from './Ui';
import { RecordActions } from '../../components/workspace/RecordActions';

export function EcnPage({ actions }: { actions: ActionSet }) {
  void actions;
  const list = useLoad(() => mlist('/ecn'), []);
  return (
    <>
      <PageHead
        title="Engineering Change Orders"
        sub="Every change raised when a released bill of materials was revised. Sales, Purchase and Production were alerted on each one."
      />
      <ErrorBox message={list.error} />
      <Grid
        rows={list.data?.rows ?? []}
        loading={list.loading}
        empty="No engineering changes yet."
        rowKey={(r) => s(r.id)}
        cols={[
          { h: 'ECN/ECO', r: (r) => s(r.number) },
          { h: 'Item', r: (r) => `${s(r.itemCode)} · ${s(r.itemName)}` },
          { h: 'From BOM', r: (r) => `${s(r.fromBomNo)} (rev ${s(r.fromRevision)})` },
          { h: 'To BOM', r: (r) => `${s(r.toBomNo)} (rev ${s(r.toRevision)})` },
          { h: 'Reason', r: (r) => s(r.reason) },
          { h: 'Raised by', r: (r) => s(r.raisedByName) },
          { h: 'Date', r: (r) => s(r.createdAt).slice(0, 10) },
          { h: '', r: (r) => <RecordActions docType="mfg-ecn" id={s(r.id)} number={s(r.number)} /> },
        ]}
      />
    </>
  );
}
