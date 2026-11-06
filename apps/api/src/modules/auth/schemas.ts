// Zod schemas for the auth endpoints. Strict objects so unknown keys are rejected with 422.
import { z } from 'zod';
import { passwordInputSchema } from '../users/schemas';

export const loginSchema = z
  .object({
    identifier: z
      .string({ required_error: 'Email or User ID is required.' })
      .trim()
      .toLowerCase()
      .min(1, 'Email or User ID is required.')
      .max(254),
    password: passwordInputSchema,
  })
  .strict();
export type LoginInput = z.output<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: passwordInputSchema,
    newPassword: passwordInputSchema,
  })
  .strict();
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;

export const mfaVerifySchema = z
  .object({
    challengeId: z.string().uuid('Invalid challenge ID.'),
    code: z.string().min(1, 'Code is required.').max(32),
  })
  .strict();
export type MfaVerifyInput = z.output<typeof mfaVerifySchema>;

export const mfaSetupSchema = z
  .object({
    currentPassword: passwordInputSchema,
  })
  .strict();
export type MfaSetupInput = z.output<typeof mfaSetupSchema>;

export const mfaEnableSchema = z
  .object({
    code: z.string().min(1, 'Code is required.').max(16),
  })
  .strict();
export type MfaEnableInput = z.output<typeof mfaEnableSchema>;

export const mfaDisableSchema = z
  .object({
    currentPassword: passwordInputSchema,
    code: z.string().min(1, 'Code is required.').max(16),
  })
  .strict();
export type MfaDisableInput = z.output<typeof mfaDisableSchema>;

export const mfaRecoveryCodesSchema = z
  .object({
    currentPassword: passwordInputSchema,
    code: z.string().min(1, 'Code is required.').max(16),
  })
  .strict();
export type MfaRecoveryCodesInput = z.output<typeof mfaRecoveryCodesSchema>;

export const passwordResetRequestSchema = z
  .object({
    email: z.string().email('Please enter a valid email address.').max(254),
  })
  .strict();
export type PasswordResetRequestInput = z.output<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(16, 'Invalid reset token.').max(128),
    newPassword: passwordInputSchema,
  })
  .strict();
export type PasswordResetConfirmInput = z.output<typeof passwordResetConfirmSchema>;

export const familyIdParamSchema = z
  .object({
    familyId: z.string().uuid('Invalid family ID.'),
  })
  .strict();
export type FamilyIdParam = z.output<typeof familyIdParamSchema>;
