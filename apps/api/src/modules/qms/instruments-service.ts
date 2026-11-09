// Phase 12 instruments list, history card and calibration. Recording a calibration moves the validity date; a FAIL puts the
// instrument out of service. The daily job tells the quality team (Phase 5 notifications) before a calibration runs out.
import { prisma } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { notificationService } from '../notifications/service';
import type { Caller } from '../records/service';
import {
  TX,
  audit,
  checkVersion,
  exec,
  insertRow,
  norm,
  pageRecipients,
  query,
  scopeSql,
  todayIst,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import { addMonths, calibrationStatus, daysLeft } from './logic';
import { S } from './inspection-service';
import { settingValue } from './registers-service';

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10);

export interface InstrumentInput {
  historyCardNo: string;
  name: string;
  equipmentNo: string;
  division?: string | undefined;
  measuringRange?: string | undefined;
  leastCount?: string | undefined;
  make?: string | undefined;
  location?: string | undefined;
  frequencyMonths?: number | undefined;
}

async function reminderDays(unitId: string | null): Promise<number> {
  return Number((await settingValue(unitId, 'CAL_REMINDER_DAYS')) ?? 15);
}
function withStatus(r: Row, today: string, remind: number): Row {
  const o = norm(r);
  const until = o.validUntil ? S(o.validUntil) : null;
  o.calibrationStatus = calibrationStatus(until, today, remind);
  o.daysLeft = until ? daysLeft(until, today) : null;
  return o;
}

export const instrumentsService = {
  async list(
    caller: Caller,
    pageId: string,
    q: {
      status?: string | undefined;
      due?: boolean | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    const remind = await reminderDays(caller.ctx.unitId);
    const today = todayIst();
    if (q.due) {
      args.push(today, remind);
      where.push(
        `t.status='ACTIVE' AND (t.valid_until IS NULL OR t.valid_until <= $${args.length - 1}::date + $${args.length}::int)`,
      );
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.name ILIKE $${args.length} OR t.equipment_no ILIKE $${args.length} OR t.history_card_no ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM qms_instruments t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, u.name AS unit_name FROM qms_instruments t JOIN units u ON u.id=t.unit_id WHERE ${w} ORDER BY t.valid_until NULLS FIRST, t.equipment_no LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => withStatus(r, today, remind)), total, reminderDays: remind };
  },
  /** the history card: the instrument and every calibration, newest first */
  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.*, u.name AS unit_name FROM qms_instruments t JOIN units u ON u.id=t.unit_id WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Instrument not found.');
    const out = withStatus(r, todayIst(), await reminderDays(S(r.unit_id)));
    out.calibrations = (
      await query(
        prisma,
        `SELECT c.*, u.name AS by_name FROM qms_calibrations c LEFT JOIN users u ON u.id=c.created_by_id WHERE c.instrument_id=$1::uuid ORDER BY c.calibrated_on DESC, c.created_at DESC`,
        id,
      )
    ).map((x) => norm(x));
    return out;
  },
  async create(caller: Caller, pageId: string, b: InstrumentInput): Promise<Row> {
    const unitId = caller.ctx.unitId;
    if (!unitId) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
    const id = await prisma.$transaction(async (tx) => {
      const dup = (
        await query(
          tx,
          `SELECT history_card_no, equipment_no FROM qms_instruments WHERE unit_id=$1::uuid AND deleted_at IS NULL AND (history_card_no=$2 OR equipment_no=$3)`,
          unitId,
          b.historyCardNo,
          b.equipmentNo,
        )
      )[0];
      if (dup)
        throw new AppError(
          409,
          'CONFLICT',
          'This history card number or equipment number is already used.',
          {
            [S(dup.history_card_no) === b.historyCardNo ? 'historyCardNo' : 'equipmentNo']:
              'Already used in this unit.',
          },
        );
      const nid = await insertRow(tx, 'qms_instruments', {
        unitId,
        historyCardNo: b.historyCardNo,
        name: b.name,
        equipmentNo: b.equipmentNo,
        division: b.division ?? null,
        measuringRange: b.measuringRange ?? null,
        leastCount: b.leastCount ?? null,
        make: b.make ?? null,
        location: b.location ?? null,
        frequencyMonths: b.frequencyMonths ?? 12,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_INSTRUMENT_CREATED',
        'qms_instrument',
        { id: nid, code: b.equipmentNo },
        pageId,
      );
      return nid;
    }, TX);
    return this.get(caller, pageId, id);
  },
  async update(
    caller: Caller,
    pageId: string,
    id: string,
    ifMatch: number,
    b: Partial<InstrumentInput> & { status?: 'ACTIVE' | 'OUT_OF_SERVICE' | 'RETIRED' | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_instruments t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Instrument not found.');
      checkVersion(cur, ifMatch);
      if (S(cur.status) === 'RETIRED')
        throw Errors.conflict('A retired instrument cannot be changed.');
      if (b.status === 'ACTIVE' && S(cur.status) !== 'ACTIVE')
        throw Errors.validation({
          status: 'Record a passing calibration before putting this instrument back in service.',
        });
      await exec(
        tx,
        `UPDATE qms_instruments SET name=COALESCE($1,name), division=COALESCE($2,division), measuring_range=COALESCE($3,measuring_range), least_count=COALESCE($4,least_count),
           make=COALESCE($5,make), location=COALESCE($6,location), frequency_months=COALESCE($7::int,frequency_months), status=COALESCE($8,status),
           version=version+1, updated_at=now(), updated_by_id=$9::uuid WHERE id=$10::uuid`,
        b.name ?? null,
        b.division ?? null,
        b.measuringRange ?? null,
        b.leastCount ?? null,
        b.make ?? null,
        b.location ?? null,
        b.frequencyMonths ?? null,
        b.status ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_INSTRUMENT_UPDATED',
        'qms_instrument',
        { id, code: S(cur.equipment_no) },
        pageId,
      );
    }, TX);
    return this.get(caller, pageId, id);
  },
  async calibrate(
    caller: Caller,
    pageId: string,
    id: string,
    b: {
      calibratedOn: string;
      validUntil?: string | undefined;
      certificateNo?: string | undefined;
      agency?: string | undefined;
      result: 'PASS' | 'FAIL';
      errorFound?: string | undefined;
      note?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM qms_instruments t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Instrument not found.');
      if (S(cur.status) === 'RETIRED')
        throw Errors.conflict('A retired instrument cannot be calibrated.');
      if (b.calibratedOn > todayIst())
        throw Errors.validation({ calibratedOn: 'The calibration date cannot be in the future.' });
      const until = b.validUntil ?? addMonths(b.calibratedOn, Number(cur.frequency_months));
      if (until < b.calibratedOn)
        throw Errors.validation({ validUntil: 'Valid until is before the calibration date.' });
      if (b.result === 'FAIL' && (b.errorFound ?? '').trim().length < 3)
        throw Errors.validation({ errorFound: 'Say what error was found.' });
      const cid = await insertRow(tx, 'qms_calibrations', {
        instrumentId: id,
        calibratedOn: b.calibratedOn,
        validUntil: until,
        certificateNo: b.certificateNo ?? null,
        agency: b.agency ?? null,
        result: b.result,
        errorFound: b.errorFound ?? null,
        note: b.note ?? null,
        createdById: caller.auth.userId,
      });
      // a pass moves the validity forward (never backwards); a fail takes the instrument out of service
      await exec(
        tx,
        `UPDATE qms_instruments SET last_calibrated_on = GREATEST(COALESCE(last_calibrated_on,$1::date), $1::date),
           valid_until = CASE WHEN $2::text = 'PASS' THEN GREATEST(COALESCE(valid_until,$3::date), $3::date) ELSE valid_until END,
           status = CASE WHEN $2::text = 'FAIL' THEN 'OUT_OF_SERVICE' WHEN status='OUT_OF_SERVICE' THEN 'ACTIVE' ELSE status END,
           version=version+1, updated_at=now(), updated_by_id=$4::uuid WHERE id=$5::uuid`,
        b.calibratedOn,
        b.result,
        until,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'QMS_CALIBRATION_RECORDED',
        'qms_instrument',
        { id, code: S(cur.equipment_no) },
        pageId,
        { result: b.result, validUntil: until, calibrationId: cid },
      );
    }, TX);
    return this.get(caller, pageId, id);
  },
};

/**
 * Daily job (qms.daily): one reminder per instrument and validity date when it comes within the reminder window, and one
 * when it has expired. The dedupe key makes a re-run send nothing new.
 */
export async function runQmsDaily(today = todayIst()): Promise<{ reminders: number }> {
  const rows = await query(
    prisma,
    `SELECT id::text, unit_id::text, name, equipment_no, history_card_no, valid_until FROM qms_instruments WHERE deleted_at IS NULL AND status='ACTIVE' AND valid_until IS NOT NULL`,
  );
  let reminders = 0;
  for (const r of rows) {
    try {
      const remind = await reminderDays(S(r.unit_id));
      const until = iso(r.valid_until);
      const st = calibrationStatus(until, today, remind);
      if (st !== 'DUE_SOON' && st !== 'EXPIRED') continue;
      const left = daysLeft(until, today);
      await prisma.$transaction(async (tx) => {
        const to = await pageRecipients(tx, 'qms-calibration');
        const got = await notificationService.notify(tx, to, {
          type: 'QMS_CALIBRATION_DUE',
          title:
            st === 'EXPIRED'
              ? `Calibration expired: ${S(r.name)} (${S(r.equipment_no)})`
              : `Calibration due in ${left} day(s): ${S(r.name)} (${S(r.equipment_no)})`,
          body: `History card ${S(r.history_card_no)}. Valid until ${until}. ${st === 'EXPIRED' ? 'Do not use it for inspection until it is calibrated.' : 'Arrange calibration.'}`,
          link: '/m/qms-calibration',
          entityType: 'qms_instrument',
          entityId: S(r.id),
          dedupeKey: `qms-cal:${S(r.id)}:${until}:${st}`,
        });
        reminders += got.length > 0 ? 1 : 0;
      }, TX);
    } catch (err) {
      logger.error({ err, instrument: r.id }, 'qms calibration reminder failed');
    }
  }
  return { reminders };
}
