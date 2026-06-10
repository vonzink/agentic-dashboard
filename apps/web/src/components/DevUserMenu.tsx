import { useState } from 'react';
import type { Role } from '../api/types';
import { loadDevUser, ROLES, saveDevUser } from '../lib/devUser';
import { AUTH_MODE, currentIdentity, logout } from '../lib/identity';

/**
 * Dev-only identity switcher. AUTH_MODE=dev trusts these values via
 * headers; this whole control is replaced by Cognito login in Phase 2.
 */
export function DevUserMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(loadDevUser());

  if (AUTH_MODE === 'cognito') {
    const identity = currentIdentity();
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="muted">
          {identity.email || 'signed in'} · {identity.role}
        </span>
        <button className="btn sm ghost" onClick={() => logout()}>
          Sign out
        </button>
      </div>
    );
  }

  const update = (patch: Partial<typeof user>) => {
    const next = { ...user, ...patch };
    setUser(next);
    saveDevUser(next);
    // Identity affects every request — simplest correct behavior is reload.
    window.location.reload();
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm ghost" onClick={() => setOpen(!open)}>
        {user.email} · {user.role} ▾
      </button>
      {open && (
        <div
          className="panel"
          style={{ position: 'absolute', right: 0, top: '110%', width: 280, zIndex: 20 }}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            Dev identity — replaced by Cognito
          </p>
          <label className="field">
            Email
            <input
              type="email"
              defaultValue={user.email}
              onBlur={(e) => e.target.value && update({ email: e.target.value })}
            />
          </label>
          <label className="field">
            Role
            <select value={user.role} onChange={(e) => update({ role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
