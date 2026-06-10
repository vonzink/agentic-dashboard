import { useEffect, useState } from 'react';
import {
  AUTH_MODE,
  beginLogin,
  completeLoginFromCallback,
  isAuthenticated,
} from '../lib/identity';
import { Loading } from './States';

/**
 * In cognito mode, completes the OAuth redirect (?code=) and shows a
 * sign-in screen until a session exists. In dev mode it renders straight
 * through — zero behavior change locally.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'anonymous' | 'ready' | 'error'>(
    AUTH_MODE === 'dev' ? 'ready' : 'checking',
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (AUTH_MODE === 'dev') return;
    completeLoginFromCallback()
      .then(() => setState(isAuthenticated() ? 'ready' : 'anonymous'))
      .catch((err: unknown) => {
        setMessage(err instanceof Error ? err.message : 'Sign-in failed.');
        setState('error');
      });
  }, []);

  if (state === 'ready') return <>{children}</>;
  if (state === 'checking') return <Loading />;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#104547' }}>
      <div className="panel" style={{ width: 360, textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>MSFG Agentic AI Dashboard</h2>
        <p className="muted">Internal tool — sign in with your MSFG account.</p>
        {state === 'error' && <div className="banner error">{message}</div>}
        <button className="btn primary" onClick={() => void beginLogin()}>
          Sign in
        </button>
      </div>
    </div>
  );
}
