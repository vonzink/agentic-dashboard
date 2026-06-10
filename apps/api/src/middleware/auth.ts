import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config';
import type { AuthUser } from '../types/domain';
import { ROLE_RANK, ROLES, type Role } from '../types/statuses';
import { bearerToken, CognitoVerifier } from './cognito';
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
 * (enforced in loadConfig).
 *
 * AUTH_MODE=cognito: Authorization: Bearer <jwt>, verified against the
 * user pool's JWKS; Cognito groups map to roles (see middleware/cognito.ts).
 */
export function authMiddleware(config: AppConfig, verifier?: CognitoVerifier): RequestHandler {
  if (config.authMode === 'cognito') {
    const cognito = verifier ?? new CognitoVerifier(config.cognito!);
    return async (req: Request, _res: Response, next: NextFunction) => {
      try {
        req.user = await cognito.verify(bearerToken(req.header('authorization')));
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    const email = (req.header('x-user-email') ?? 'dev@msfg.local').trim().toLowerCase();
    // Least privilege: requests that don't state a role get read-only access.
    const roleHeader = (req.header('x-user-role') ?? 'viewer').trim().toLowerCase();
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
