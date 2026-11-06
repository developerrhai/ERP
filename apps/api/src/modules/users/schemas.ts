// Zod schemas for every users endpoint: strict (unknown keys -> 422), trimmed strings, lowercase
// loginId/email. Departments are checked against the active DB departments in the service.
import { z } from 'zod';
import { offsetWithinCap } from '../../core/http/query-safety';

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

export const departmentSchema = z.preprocess(
  (value) => emptyToNull(trimIfString(value)),
  z
    .string({ invalid_type_error: 'Choose one of the listed departments.' })
    .min(2, 'Choose one of the listed departments.')
    .max(60, 'Choose one of the listed departments.')
    .nullable(),
);

export const extraDepartmentsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(2, 'Choose one of the listed departments.')
      .max(60, 'Choose one of the listed departments.'),
    { invalid_type_error: 'Extra departments must be an array of department names.' },
  )
  .max(10, 'Up to 10 extra departments.')
  .refine(
    (depts) => new Set(depts).size === depts.length,
    'Each extra department may be listed only once.',
  );

export const approvalLimitSchema = z.preprocess(
  emptyToNull,
  z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount of 0 or more with up to 2 decimals.'),
      z
        .number({ invalid_type_error: 'Enter an amount of 0 or more with up to 2 decimals.' })
        .min(0, 'Enter an amount of 0 or more with up to 2 decimals.')
        .transform((n) => n.toFixed(2)),
    ])
    .nullable(),
);

export const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);

/** Phase 3: the units a user may work in (existence / status / role rules are in the service). */
export const unitIdsSchema = z
  .array(z.string().uuid('Choose from the listed units.'), {
    invalid_type_error: 'Choose from the listed units.',
  })
  .max(100, 'Too many units.')
  .refine((ids) => new Set(ids).size === ids.length, 'Each unit may be listed only once.');

export const defaultUnitIdSchema = z.preprocess(
  emptyToNull,
  z.string().uuid('Choose one of the listed units.').nullable(),
);

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
    roleId: z.string().uuid().optional(),
    role: z.string().trim().optional(),
    department: departmentSchema.optional(),
    extraDepartments: extraDepartmentsSchema.optional(),
    approvalLimit: approvalLimitSchema.optional(),
    temporaryPassword: passwordInputSchema,
    unitIds: unitIdsSchema.optional(),
    defaultUnitId: defaultUnitIdSchema.optional(),
  })
  .strict()
  .refine((data) => Boolean(data.roleId || data.role), {
    message: 'Role is required.',
    path: ['roleId'],
  });

export type CreateUserInput = z.output<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    name: nameSchema.optional(),
    roleId: z.string().uuid().optional(),
    role: z.string().trim().optional(),
    department: departmentSchema.optional(),
    extraDepartments: extraDepartmentsSchema.optional(),
    approvalLimit: approvalLimitSchema.optional(),
    status: statusSchema.optional(),
    unitIds: unitIdsSchema.optional(),
    defaultUnitId: defaultUnitIdSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Provide at least one field to change.',
  });

export type UpdateUserInput = z.output<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ temporaryPassword: passwordInputSchema }).strict();
export type ResetPasswordInput = z.output<typeof resetPasswordSchema>;

export const USER_SORT_FIELDS = [
  'loginId',
  '-loginId',
  'name',
  '-name',
  'department',
  '-department',
  'role',
  '-role',
  'status',
  '-status',
  'createdAt',
  '-createdAt',
] as const;

export const ALLOWED_ROLE_QUERY = [
  'SUPER_USER',
  'ADMINISTRATOR',
  'DIRECTOR',
  'CFO',
  'GENERAL_MANAGER',
  'DEPT_HEAD',
  'DEPT_MANAGER',
  'SUPERVISOR',
  'EMPLOYEE',
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'LEAD',
  'MEMBER',
] as const;

export const listUsersQuerySchema = z
  .object({
    roleId: z.string().uuid().optional(),
    role: z.enum(ALLOWED_ROLE_QUERY).optional(),
    department: z.string().trim().optional(),
    status: statusSchema.optional(),
    unitId: z.string().uuid().optional(),
    sort: z.enum(USER_SORT_FIELDS).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine(offsetWithinCap);

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const effectiveAccessQuerySchema = z
  .object({
    family: z.string().trim().max(100).optional(),
  })
  .strict();
export type EffectiveAccessQuery = z.infer<typeof effectiveAccessQuerySchema>;

export const userIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
