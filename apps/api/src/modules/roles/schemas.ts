import { z } from 'zod';

export const CreateRoleSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Code must be 2–30 capital letters, digits or _.'),
    name: z
      .string()
      .trim()
      .min(2, 'Name must be 2–60 characters.')
      .max(60, 'Name must be 2–60 characters.'),
    level: z
      .number({ invalid_type_error: 'Level must be a whole number from 1 to 99.' })
      .int('Level must be a whole number from 1 to 99.')
      .min(1, 'Level must be a whole number from 1 to 99.')
      .max(99, 'Level must be a whole number from 1 to 99.'),
    description: z.string().max(300, 'Description must be at most 300 characters.').optional(),
    allUnits: z.boolean().optional(),
    copyFromRoleId: z.string().uuid().optional(),
  })
  .strict();

export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be 2–60 characters.')
      .max(60, 'Name must be 2–60 characters.')
      .optional(),
    level: z
      .number({ invalid_type_error: 'Level must be a whole number from 1 to 99.' })
      .int('Level must be a whole number from 1 to 99.')
      .min(1, 'Level must be a whole number from 1 to 99.')
      .max(99, 'Level must be a whole number from 1 to 99.')
      .optional(),
    description: z.string().max(300, 'Description must be at most 300 characters.').optional(),
    allUnits: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
