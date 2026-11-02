// Adds the fields our middleware sets (requestId, auth, ctx) to Express's Request type, so handlers
// can read them with full type safety instead of casting.
import type { AuthContext } from '../core/auth/auth-context';
import type { RequestContext } from '../core/context/resolve-context';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: AuthContext;
      /** Phase 3 working context (unit / FY), set by resolveContext. */
      ctx?: RequestContext;
    }
  }
}

export {};
