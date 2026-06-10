import { useState } from 'react';
import type { AuditEvent } from '../api/types';
import { fmtDate } from '../lib/format';

function Entry({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const hasPayload = Object.keys(event.event_payload_json ?? {}).length > 0;
  return (
    <li>
      <div>
        <strong>{event.event_type}</strong>{' '}
        <span className="muted">{event.actor_user_id ?? 'system'}</span>
        {hasPayload && (
          <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => setOpen(!open)}>
            {open ? 'hide' : 'details'}
          </button>
        )}
      </div>
      <div className="when">{fmtDate(event.created_at)}</div>
      {open && <pre>{JSON.stringify(event.event_payload_json, null, 2)}</pre>}
    </li>
  );
}

export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <p className="muted">No audit events yet.</p>;
  return (
    <ul className="timeline">
      {events.map((e) => (
        <Entry key={e.id} event={e} />
      ))}
    </ul>
  );
}
