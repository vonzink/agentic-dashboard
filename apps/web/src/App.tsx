import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { USE_MOCKS } from './api/client';
import { useHealth } from './api/hooks';
import { CompanySwitcher } from './components/CompanySwitcher';
import { DevUserMenu } from './components/DevUserMenu';

const NAV = [
  { to: '/', label: 'Dashboard', title: 'Dashboard' },
  { to: '/tasks', label: 'Task Queue', title: 'AI Task Queue' },
  { to: '/approvals', label: 'Approval Center', title: 'Human Approval Center' },
  { to: '/documents', label: 'Documents', title: 'Document Library' },
  { to: '/audit', label: 'Audit Log', title: 'Audit Log' },
  { to: '/admin', label: 'Admin', title: 'Prompt & Workflow Admin' },
];

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/tasks/new')) return 'New AI Task';
  if (pathname.startsWith('/tasks/')) return 'Task Detail';
  const hit = [...NAV].sort((a, b) => b.to.length - a.to.length).find((n) =>
    n.to === '/' ? pathname === '/' : pathname.startsWith(n.to),
  );
  return hit?.title ?? 'MSFG Agentic AI Dashboard';
}

export default function App() {
  const { data: health } = useHealth();
  const env = import.meta.env.VITE_ENV ?? 'local';
  const location = useLocation();
  const healthy = health?.status === 'ok' && health.db !== 'down';

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          ZVZ Solutions
          <small>Agentic AI Dashboard</small>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="foot">
          AI drafts · humans decide.
          <br />
          All activity is audited.
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{pageTitle(location.pathname)}</h1>
          <CompanySwitcher />
          {USE_MOCKS && <span className="badge amber">MOCK DATA</span>}
          <span className={`badge env-badge ${env === 'prod' ? 'red' : env === 'local' ? 'neutral' : 'teal'}`}>
            {env}
          </span>
          <span
            className={`status-dot ${healthy ? 'ok' : 'bad'}`}
            title={healthy ? `API ok · db ${health?.db} · provider ${health?.provider.name}` : 'API unreachable or degraded'}
          />
          <DevUserMenu />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
