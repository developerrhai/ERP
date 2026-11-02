// Field schemas shared by several masters (Phase 3 company and units): optional text that turns ''
// into null, and the Indian GSTIN / PAN / CIN identifiers (trimmed, upper-cased, same patterns as
// the letterhead).
import { z } from 'zod';
import { CIN_PATTERN, GSTIN_PATTERN, PAN_PATTERN } from '../../modules/settings/schemas';

const blankToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Optional free text: blank -> null; otherwise trimmed and at most `max` characters. */
export const nullableText = (max: number) =>
  z.preprocess(
    blankToNull,
    z.string().trim().max(max, `Must be at most ${max} characters.`).nullable(),
  );

const nullablePattern = (re: RegExp, message: string) =>
  z.preprocess(blankToNull, z.string().trim().toUpperCase().regex(re, message).nullable());

export const gstinSchema = nullablePattern(
  GSTIN_PATTERN,
  'Enter a valid 15-character GSTIN or leave it empty.',
);
export const panSchema = nullablePattern(
  PAN_PATTERN,
  'Enter a valid PAN (e.g. ABCDE1234F) or leave it empty.',
);
export const cinSchema = nullablePattern(
  CIN_PATTERN,
  'Enter a valid 21-character CIN or leave it empty.',
);
