// Zod schemas for every users endpoint: strict (unknown keys -> 422), trimmed strings, lowercase
// loginId/email. Departments are checked against the active DB departments in the service (Phase 2 §3).
// Shared field schemas keep create/update consistent.
import { z } from 'zod';
import { ROLES } from '../../core/rbac/role-rules';

const trimIfString = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;
const emptyToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export const loginIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._@-]{3,64}$/,
    'Login ID must be 3-64 characters using letters, digits, ".", "_", "@" or "-".',
  );

export const emailSchema = z.preprocess(
  emptyToNull,
  z.string().trim().toLowerCase().max(254).email('Enter a valid email address.').nullable(),
);

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(100, 'Name must be at most 100 characters.');

export const roleSchema = z.enum(ROLES, {
  errorMap: () => ({ message: `Role must be one of ${ROLES.join(', ')}.` }),
});

export const departmentSchema = z.preprocess(
  (value) => emptyToNull(trimIfString(value)),
  z
    .string({ invalid_type_error: 'Choose one of the listed departments.' })
    .min(2, 'Choose one of the listed departments.')
    .max(60, 'Choose one of the listed departments.')
    .nullable(),
);

export const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);

/** Passwords are not trimmed: whitespace is a legitimate password character. */
export const passwordInputSchema = z
  .string({ required_error: 'Password is required.' })
  .min(1, 'Password is required.')
  .max(256, 'Password is too long.');

export const createUserSchema = z
  .object({
    loginId: loginIdSchema,
    email: emailSchema.optional(),
    name: nameSchema,
    role: roleSchema,
    department: departmentSchema.optional(),
    temporaryPassword: passwordInputSchema,
  })
  .strict();
export type CreateUserInput = z.output<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    department: departmentSchema.optional(),
    status: statusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Provide at least one field to change.',
  });
export type UpdateUserInput = z.output<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ temporaryPassword: passwordInputSchema }).strict();
export type ResetPasswordInput = z.output<typeof resetPasswordSchema>;

export const USER_SORTS = [
  'name',
  '-name',
  'loginId',
  '-loginId',
  'createdAt',
  '-createdAt',
  'lastLoginAt',
  '-lastLoginAt',
  'role',
  '-role',
  'department',
  '-department',
] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const listUsersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    role: roleSchema.optional(),
    status: statusSchema.optional(),
    department: z.string().trim().min(1).max(60).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(USER_SORTS).default('name'),
  })
  .strict();
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.object({ id: z.string().uuid('Invalid user id.') }).strict();
