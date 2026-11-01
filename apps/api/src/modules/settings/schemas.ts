// Zod schema for the letterhead setting (Phase 2 §2.3): the prototype's 11 fields with their
// limits and the Indian GSTIN / PAN / CIN patterns. Optional fields may be empty strings; GSTIN,
// PAN and CIN are upper-cased before matching.
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max, `Must be at most ${max} characters.`);
const optionalText = (max: number) => text(max).default('');
const emptyOr = (schema: z.ZodTypeAny, message: string) =>
  z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || schema.safeParse(v).success, message);
const upperPattern = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .default('')
    .refine((v) => v === '' || re.test(v), message);

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

export const letterheadSchema = z
  .object({
    companyName: text(120).min(1, 'Company name is required.'),
    legalName: optionalText(300),
    address: optionalText(300),
    phone: optionalText(30),
    email: emptyOr(z.string().email().max(254), 'Enter a valid email address or leave it empty.'),
    website: emptyOr(
      z
        .string()
        .url()
        .max(200)
        .refine((v) => /^https?:\/\//i.test(v)),
      'Enter a valid http(s) URL or leave it empty.',
    ),
    gstin: upperPattern(GSTIN_PATTERN, 'Enter a valid 15-character GSTIN or leave it empty.'),
    pan: upperPattern(PAN_PATTERN, 'Enter a valid PAN (e.g. ABCDE1234F) or leave it empty.'),
    cin: upperPattern(CIN_PATTERN, 'Enter a valid 21-character CIN or leave it empty.'),
    footer: optionalText(200),
    signatory: optionalText(100),
  })
  .strict();
export type Letterhead = z.output<typeof letterheadSchema>;
