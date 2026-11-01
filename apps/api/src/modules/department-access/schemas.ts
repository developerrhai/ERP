// Zod schemas for PUT /department-access/:department (family names are checked in the service).
import { z } from 'zod';

export const departmentParamsSchema = z
  .object({ department: z.string().trim().min(1).max(60) })
  .strict();

export const putDepartmentAccessSchema = z
  .object({ families: z.array(z.string().trim().min(1).max(60)).max(100) })
  .strict();
