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
