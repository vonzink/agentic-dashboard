import type { DevUser, Role } from '../api/types';

const STORAGE_KEY = 'msfg.devUser';

export const ROLES: Role[] = ['viewer', 'operator', 'reviewer', 'admin'];

export const DEFAULT_DEV_USER: DevUser = { email: 'dev@msfg.local', role: 'operator' };

export function loadDevUser(): DevUser {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DEV_USER;
    const parsed = JSON.parse(raw) as Partial<DevUser>;
    if (typeof parsed.email === 'string' && ROLES.includes(parsed.role as Role)) {
      return { email: parsed.email, role: parsed.role as Role };
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_DEV_USER;
}

export function saveDevUser(user: DevUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}
