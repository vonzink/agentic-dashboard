/**
 * Identity for the SPA, in one of two modes:
 *
 *  - dev (default): x-user-email/x-user-role headers from the local
 *    identity switcher. The API trusts these only when AUTH_MODE=dev.
 *  - cognito (VITE_AUTH_MODE=cognito): OAuth2 authorization-code + PKCE
 *    against the Cognito hosted UI; the API receives Authorization: Bearer
 *    and verifies against the pool's JWKS.
 *
 * The role decoded here drives UI affordances only — the server re-derives
 * the role from the verified token and is always authoritative.
 */
import type { Role } from '../api/types';
import { loadDevUser } from './devUser';

export type AuthMode = 'dev' | 'cognito';

export const AUTH_MODE: AuthMode =
  import.meta.env.VITE_AUTH_MODE === 'cognito' ? 'cognito' : 'dev';

const COGNITO = {
  /** e.g. https://msfg-agentic-dev.auth.us-east-1.amazoncognito.com */
  domain: (import.meta.env.VITE_COGNITO_DOMAIN ?? '').replace(/\/$/, ''),
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
  redirectUri: import.meta.env.VITE_COGNITO_REDIRECT_URI ?? window.location.origin,
};

const TOKEN_KEY = 'msfg.tokens';
const PKCE_KEY = 'msfg.pkce';

interface StoredTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  /** epoch ms when the access token expires */
  expires_at: number;
}

// ---- small codecs -----------------------------------------------------------

const b64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---- token storage ----------------------------------------------------------

function loadTokens(): StoredTokens | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function saveTokens(t: StoredTokens): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

// ---- PKCE login flow ---------------------------------------------------------

/** Redirects to the Cognito hosted UI (authorization code + PKCE, S256). */
export async function beginLogin(): Promise<void> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes.buffer);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: COGNITO.clientId,
    redirect_uri: COGNITO.redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${COGNITO.domain}/oauth2/authorize?${params}`);
}

/**
 * Handles ?code=&state= after the hosted-UI redirect: exchanges the code
 * for tokens and strips the query from the URL. Returns true when a login
 * was completed on this load.
 */
export async function completeLoginFromCallback(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return false;

  const pkceRaw = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (!pkceRaw) throw new Error('Login state missing — start again.');
  const pkce = JSON.parse(pkceRaw) as { verifier: string; state: string };
  if (state !== pkce.state) throw new Error('Login state mismatch — start again.');

  await exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: COGNITO.redirectUri,
    code_verifier: pkce.verifier,
  });

  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  return true;
}

async function exchange(params: Record<string, string>): Promise<void> {
  const res = await fetch(`${COGNITO.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: COGNITO.clientId, ...params }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const body = (await res.json()) as {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const existing = loadTokens();
  saveTokens({
    access_token: body.access_token,
    id_token: body.id_token,
    // Refresh-token grants don't return a new refresh token; keep the old one.
    refresh_token: body.refresh_token ?? existing?.refresh_token,
    expires_at: Date.now() + (body.expires_in - 60) * 1000, // refresh a minute early
  });
}

export function logout(): void {
  clearTokens();
  const params = new URLSearchParams({
    client_id: COGNITO.clientId,
    logout_uri: COGNITO.redirectUri,
  });
  window.location.assign(`${COGNITO.domain}/logout?${params}`);
}

// ---- consumption -------------------------------------------------------------

export function isAuthenticated(): boolean {
  if (AUTH_MODE === 'dev') return true;
  return loadTokens() != null;
}

/** Valid access token, refreshing if needed; null = session over. */
async function accessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  if (!tokens.refresh_token) {
    clearTokens();
    return null;
  }
  try {
    await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    return loadTokens()?.access_token ?? null;
  } catch {
    clearTokens();
    return null;
  }
}

/** Auth headers for API calls (dev headers, or Bearer in cognito mode). */
export async function authHeaders(): Promise<Record<string, string>> {
  if (AUTH_MODE === 'dev') {
    const user = loadDevUser();
    return { 'x-user-email': user.email, 'x-user-role': user.role };
  }
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, reviewer: 2, admin: 3 };

export interface Identity {
  email: string;
  role: Role;
  mode: AuthMode;
}

/** UI-side identity; the server independently verifies on every request. */
export function currentIdentity(): Identity {
  if (AUTH_MODE === 'dev') {
    const user = loadDevUser();
    return { ...user, mode: 'dev' };
  }
  const tokens = loadTokens();
  const payload = tokens ? decodeJwtPayload(tokens.id_token) : null;
  const email =
    (typeof payload?.email === 'string' && payload.email) ||
    (typeof payload?.['cognito:username'] === 'string' && (payload['cognito:username'] as string)) ||
    '';
  let role: Role = 'viewer';
  const groups = payload?.['cognito:groups'];
  const prefix = import.meta.env.VITE_COGNITO_GROUP_PREFIX ?? '';
  if (Array.isArray(groups)) {
    for (const g of groups) {
      if (typeof g !== 'string' || !g.startsWith(prefix)) continue;
      const candidate = g.slice(prefix.length);
      if (candidate in ROLE_RANK && ROLE_RANK[candidate as Role] > ROLE_RANK[role]) {
        role = candidate as Role;
      }
    }
  }
  return { email, role, mode: 'cognito' };
}
