// Adds the fields our middleware sets (requestId, auth) to Express's Request type, so handlers can
// read them with full type safety instead of casting.
import type { AuthContext } from '../core/auth/auth-context';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: AuthContext;
    }
  }
}

export {};
