import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config';
import type { AuthUser } from '../types/domain';
import { ROLE_RANK, ROLES, type Role } from '../types/statuses';
import { ApiError } from './error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * AUTH_MODE=dev: identity comes from x-user-email / x-user-role headers.
 * This is for local development ONLY and refuses to load in production
 * (enforced in loadConfig). Replaced by Cognito JWT verification in AWS.
 *
 * AUTH_MODE=cognito: fail-closed placeholder. Verifying Cognito JWTs
 * (issuer https://cognito-idp.<region>.amazonaws.com/<poolId>, JWKS
 * signature, aud/client_id, token_use, exp) is Phase 2 work — until that
 * lands, every request is rejected rather than trusted.
 */
export function authMiddleware(config: AppConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (config.authMode === 'cognito') {
      next(
        new ApiError(
          501,
          'AUTH_NOT_CONFIGURED',
          'Cognito JWT verification is not enabled yet; refusing to authenticate',
        ),
      );
      return;
    }

    const email = (req.header('x-user-email') ?? 'dev@msfg.local').trim().toLowerCase();
    const roleHeader = (req.header('x-user-role') ?? 'operator').trim().toLowerCase();
    if (!(ROLES as readonly string[]).includes(roleHeader)) {
      next(ApiError.badRequest(`x-user-role must be one of: ${ROLES.join(', ')}`));
      return;
    }
    req.user = { email, role: roleHeader as Role };
    next();
  };
}

/** Allows the request when the user's role is at least `minimum`. */
export function requireRole(minimum: Role): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
      return;
    }
    if (ROLE_RANK[user.role] < ROLE_RANK[minimum]) {
      next(ApiError.forbidden('INSUFFICIENT_ROLE', `Requires role ${minimum} or higher`));
      return;
    }
    next();
  };
}

/** The authenticated user; throws if middleware did not run. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.user;
}
