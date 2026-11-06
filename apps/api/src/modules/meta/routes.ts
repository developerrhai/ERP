// Route table for /meta. Bearer only: deliberately reachable while mustChangePassword is set
// (CONTRACT §6), because the change-password screen may need it.
import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { metaController } from './controller';

export function createMetaRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/roles', asyncHandler(metaController.roles));
  router.get('/departments', asyncHandler(metaController.departments));
  return router;
}
