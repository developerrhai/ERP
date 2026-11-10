import { describe, it, expect } from 'vitest';
import {
  movingAverageForecast,
  sesForecast,
  holtForecast,
  autoSelectHolt,
  detectZScoreAnomaly,
  safeRatio,
  computeOee,
  evaluateConditionAst,
  signStandardWebhook,
  verifyStandardWebhook,
  verifyMetaSignature,
  verifyRazorpaySignature,
  validateWebhookUrl,
  validateDltSms,
  validateWhatsAppPreSend,
} from '../src/bi/index.js';

describe('Phase 19 BI, Forecasting, Anomaly, Automation, Webhooks & Comm Tests', () => {
  it('Holt Worked Example: α=0.5, β=0.3 -> Forecasts 139.36, 145.93, 152.51, RMSE 2.79, Band ±5.47', () => {
    const y = [100, 108, 112, 121, 125, 132];
    const res = holtForecast(y, 0.5, 0.3, 3);
    expect(res.points[0]!.estimate).toBeCloseTo(139.36, 2);
    expect(res.points[1]!.estimate).toBeCloseTo(145.93, 2);
    expect(res.points[2]!.estimate).toBeCloseTo(152.51, 2);
    expect(res.rmse).toBeCloseTo(2.79, 2);
    expect(res.band).toBeCloseTo(5.47, 2);
    expect(res.label).toContain('Estimate · Holt (α 0.5, β 0.3)');

    // Fewer than 6 periods -> error
    expect(() => holtForecast([100, 108, 112, 121], 0.5, 0.3, 3)).toThrow(
      'Not enough history (needs 6 periods, found 4).',
    );
  });

  it('MA, SES & Auto-Select Holt Grid Search', () => {
    const y = [100, 105, 110, 115, 120, 125, 130];
    const ma = movingAverageForecast(y, 3, 2);
    expect(ma.points[0]!.estimate).toBe(125);
    const ses = sesForecast(y, 0.5, 2);
    expect(ses.points.length).toBe(2);
    const auto = autoSelectHolt(y, 3);
    expect(auto.points[0]!.estimate).toBeGreaterThan(130);
  });

  it('Z-Score Anomaly Worked Example: rejections mean 42.0, sd 2.16, today 68 -> z 12.0', () => {
    const trailing = [42, 40, 45, 41, 43, 44, 39];
    const res = detectZScoreAnomaly(trailing, 68);
    expect(res.mean).toBe(42);
    expect(res.sd).toBe(2.16);
    expect(res.zScore).toBeCloseTo(12.04, 1);
    expect(res.anomaly).toBe(true);

    // Zero variance -> skipped
    const flat = detectZScoreAnomaly([10, 10, 10, 10, 10, 10, 10], 15);
    expect(flat.anomaly).toBe(false);
    expect(flat.skippedReason).toBe('Zero variance');
  });

  it('KPI Safe Ratio returns null on 0 denominator, never 0%', () => {
    expect(safeRatio(50, 0, 100)).toBeNull();
    expect(computeOee(90, 95, 98)).toBe(83.79);
  });

  it('Automation AST Pure Evaluator & Depth Limit (max 5)', () => {
    const ast = {
      all: [
        { field: 'amount', op: 'gt' as const, value: 50000 },
        { any: [{ field: 'unit', op: 'eq' as const, value: 'SAW' }, { field: 'priority', op: 'eq' as const, value: 1 }] },
      ],
    };
    expect(evaluateConditionAst(ast, { amount: 75000, unit: 'SAW', priority: 3 })).toBe(true);
    expect(evaluateConditionAst(ast, { amount: 25000, unit: 'SAW', priority: 3 })).toBe(false);

    // Depth 6 exceeds max 5
    const deep: any = { field: 'a', op: 'eq', value: 1 };
    const wrapped = { all: [{ all: [{ all: [{ all: [{ all: [deep] }] }] }] }] };
    expect(() => evaluateConditionAst(wrapped, { a: 1 })).toThrow('Condition tree too deep (max 5).');
  });

  it('Standard Webhooks Signing, Replay Tolerance, SSRF Guard, Meta & Razorpay Signatures', () => {
    const secret = 'whsec_dGVzdHNlY3JldGtleTEyMzQ1Njc4OTA=';
    const now = 1730000000;
    const body = JSON.stringify({ event: 'invoice.overdue', id: '123' });
    const sig = signStandardWebhook({ webhookId: 'msg_1', timestampSec: now, body, secret });

    expect(
      verifyStandardWebhook({ webhookId: 'msg_1', timestampSec: now, signatureHeader: sig, body, secret, nowSec: now + 60 }).ok,
    ).toBe(true);
    // Outside 5-min tolerance
    expect(
      verifyStandardWebhook({ webhookId: 'msg_1', timestampSec: now, signatureHeader: sig, body, secret, nowSec: now + 400 }).ok,
    ).toBe(false);

    // SSRF guard
    expect(validateWebhookUrl('https://192.168.1.5/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://10.0.0.1/hook').valid).toBe(false);
    expect(validateWebhookUrl('https://169.254.169.254/latest').valid).toBe(false);
    expect(validateWebhookUrl('http://hooks.partner.com/webhook').valid).toBe(false);
    expect(validateWebhookUrl('https://hooks.partner.com/webhook').valid).toBe(true);

    expect(verifyMetaSignature(body, 'sha256=invalid', 'secret')).toBe(false);
    expect(verifyRazorpaySignature(body, 'invalid', 'secret')).toBe(false);
  });

  it('Communication TRAI DLT & WhatsApp Validators', () => {
    // 1. Valid transactional SMS
    expect(
      validateDltSms({
        dltTemplateId: '11071690000001',
        dltHeader: 'SAWGRP-S',
        templateBody: 'Invoice {#var#} of INR {#var#} due.',
        renderedBody: 'Invoice INV/001 of INR 15000 due.',
        variables: ['INV/001', '15000'],
        category: 'TRANSACTIONAL',
      }).status,
    ).toBe('ALLOWED');

    // 2. Variable > 30 chars
    expect(
      validateDltSms({
        dltTemplateId: '11071690000001',
        dltHeader: 'SAWGRP-S',
        templateBody: 'Hi {#var#}',
        renderedBody: 'Hi AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        variables: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
        category: 'TRANSACTIONAL',
      }).reason,
    ).toContain('exceeds 30 characters');

    // 3. Promotional window outside 10-21 IST
    expect(
      validateDltSms({
        dltTemplateId: '11071690000002',
        dltHeader: 'SAWGRP-P',
        templateBody: 'Sale {#var#}',
        renderedBody: 'Sale 20% Off',
        variables: ['20% Off'],
        category: 'PROMOTIONAL',
        istHour: 22,
      }).status,
    ).toBe('QUEUED_WINDOW');

    // 4. WhatsApp checks
    expect(validateWhatsAppPreSend({ optedIn: false, waStatus: 'APPROVED' }).reason).toBe(
      'Contact has not opted in to WhatsApp.',
    );
    expect(validateWhatsAppPreSend({ optedIn: true, waStatus: 'PAUSED' }).reason).toBe(
      'Template not approved by Meta (status PAUSED).',
    );
  });
});

