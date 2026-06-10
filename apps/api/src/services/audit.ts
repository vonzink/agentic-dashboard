import type { Store } from '../repositories/interfaces';
import type { AuditEvent } from '../types/domain';

/**
 * Append-only audit writer. Every service-level state change calls this.
 * Event types follow `<entity>.<action>` (task.created, output.approved,
 * action.blocked, ...). The underlying table forbids UPDATE/DELETE.
 */
export class AuditService {
  constructor(private store: Store) {}

  async record(
    eventType: string,
    opts: {
      taskId?: string | null;
      actor?: string | null;
      payload?: Record<string, unknown>;
    } = {},
  ): Promise<AuditEvent> {
    return this.store.audit.append({
      task_id: opts.taskId ?? null,
      actor_user_id: opts.actor ?? null,
      event_type: eventType,
      event_payload_json: opts.payload ?? {},
    });
  }
}
