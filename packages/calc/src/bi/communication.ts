/**
 * Indian Communication Pre-Send Validators:
 * - TRAI DLT (SMS): Principal Entity ID, 6-char header (-S/-P/-T/-G), exact template match, {#var#} <= 30 chars, whitelisted URLs, 10:00-21:00 IST promo window
 * - WhatsApp Cloud API: opt-in consent, Meta template APPROVED status
 */

export interface SmsValidationInput {
  dltTemplateId?: string | null;
  dltHeader?: string | null;
  templateBody: string;
  renderedBody: string;
  variables: string[];
  whitelistedUrls?: string[];
  category: 'TRANSACTIONAL' | 'SERVICE' | 'PROMOTIONAL';
  /** Hour in IST (0..23) */
  istHour?: number;
}

export function validateDltSms(input: SmsValidationInput): {
  status: 'ALLOWED' | 'QUEUED_WINDOW' | 'BLOCKED';
  reason?: string;
} {
  if (!input.dltTemplateId || input.dltTemplateId.trim().length === 0) {
    return { status: 'BLOCKED', reason: 'DLT template ID is required.' };
  }

  const header = (input.dltHeader ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}-(S|P|T|G)$/.test(header)) {
    return {
      status: 'BLOCKED',
      reason: 'Invalid DLT header (must be 6 alphanumeric chars with -S/-P/-T/-G suffix).',
    };
  }

  for (let i = 0; i < input.variables.length; i++) {
    const v = input.variables[i] ?? '';
    if (v.length > 30) {
      return {
        status: 'BLOCKED',
        reason: `Variable ${i + 1} exceeds 30 characters.`,
      };
    }
  }

  // Exact template match check replacing {#var#} placeholders with supplied variables
  let expected = input.templateBody;
  for (const v of input.variables) {
    expected = expected.replace('{#var#}', v);
  }
  if (expected.trim() !== input.renderedBody.trim()) {
    return {
      status: 'BLOCKED',
      reason: `Message does not match DLT template ${input.dltTemplateId}.`,
    };
  }

  // Whitelisted URLs check
  const urlsInBody = input.renderedBody.match(/https?:\/\/[^\s]+/gi) ?? [];
  const whitelist = (input.whitelistedUrls ?? []).map((u) => u.toLowerCase());
  for (const url of urlsInBody) {
    const lower = url.toLowerCase();
    if (!whitelist.some((w) => lower.startsWith(w))) {
      return { status: 'BLOCKED', reason: 'URL not whitelisted in template.' };
    }
  }

  // Promotional window 10:00 - 21:00 IST
  if (input.category === 'PROMOTIONAL') {
    const hr = input.istHour ?? 12;
    if (hr < 10 || hr >= 21) {
      return {
        status: 'QUEUED_WINDOW',
        reason: 'Queued for 10:00 IST (TRAI promotional window).',
      };
    }
  }

  return { status: 'ALLOWED' };
}

export function validateWhatsAppPreSend(input: {
  optedIn: boolean;
  within24hWindow?: boolean;
  waStatus?: string | null;
}): { allowed: boolean; reason?: string } {
  if (!input.optedIn) {
    return { allowed: false, reason: 'Contact has not opted in to WhatsApp.' };
  }
  if (!input.within24hWindow) {
    const st = (input.waStatus ?? 'PENDING').toUpperCase();
    if (st !== 'APPROVED') {
      return { allowed: false, reason: `Template not approved by Meta (status ${st}).` };
    }
  }
  return { allowed: true };
}

