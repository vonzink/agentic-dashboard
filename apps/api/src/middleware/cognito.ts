import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AuthUser } from '../types/domain';
import { ROLE_RANK, ROLES, type Role } from '../types/statuses';
import { ApiError } from './error';

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
}

/**
 * Verifies AWS Cognito JWTs (RS256 against the pool's JWKS) and maps the
 * token to an AuthUser.
 *
 * Accepted tokens:
 *  - access tokens: token_use === 'access' and client_id === clientId
 *  - id tokens:     token_use === 'id' and aud === clientId
 *
 * Role mapping: the user's Cognito groups (cognito:groups) are matched
 * against our role names (viewer/operator/reviewer/admin) — optionally
 * prefixed (e.g. 'msfg-admin' matches with prefix 'msfg-'). The HIGHEST
 * matching role wins; users with no matching group get 'viewer'
 * (least privilege, read-only).
 */
export class CognitoVerifier {
  private readonly issuer: string;
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    private config: CognitoConfig,
    /** Injectable for tests (local JWKS); defaults to the pool's remote JWKS. */
    getKey?: JWTVerifyGetKey,
    private groupPrefix = process.env.COGNITO_GROUP_PREFIX ?? '',
  ) {
    this.issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
    this.getKey =
      getKey ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async verify(token: string): Promise<AuthUser> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        algorithms: ['RS256'],
      }));
    } catch {
      // Never leak why verification failed.
      throw new ApiError(401, 'INVALID_TOKEN', 'Token verification failed');
    }

    const tokenUse = payload['token_use'];
    if (tokenUse === 'access') {
      if (payload['client_id'] !== this.config.clientId) {
        throw new ApiError(401, 'INVALID_TOKEN', 'Token verification failed');
      }
    } else if (tokenUse === 'id') {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(this.config.clientId)) {
        throw new ApiError(401, 'INVALID_TOKEN', 'Token verification failed');
      }
    } else {
      throw new ApiError(401, 'INVALID_TOKEN', 'Token verification failed');
    }

    const email =
      (typeof payload['email'] === 'string' && payload['email']) ||
      (typeof payload['username'] === 'string' && payload['username']) ||
      (typeof payload['cognito:username'] === 'string' && (payload['cognito:username'] as string)) ||
      payload.sub;
    if (!email) throw new ApiError(401, 'INVALID_TOKEN', 'Token verification failed');

    return { email: String(email).toLowerCase(), role: this.roleFromGroups(payload) };
  }

  private roleFromGroups(payload: JWTPayload): Role {
    const groups = payload['cognito:groups'];
    if (!Array.isArray(groups)) return 'viewer';
    let best: Role = 'viewer';
    for (const group of groups) {
      if (typeof group !== 'string' || !group.startsWith(this.groupPrefix)) continue;
      const candidate = group.slice(this.groupPrefix.length);
      if ((ROLES as readonly string[]).includes(candidate)) {
        const role = candidate as Role;
        if (ROLE_RANK[role] > ROLE_RANK[best]) best = role;
      }
    }
    return best;
  }
}

export function bearerToken(header: string | undefined): string {
  if (!header?.startsWith('Bearer ')) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer token required');
  }
  return header.slice('Bearer '.length).trim();
}
