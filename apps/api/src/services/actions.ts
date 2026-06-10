import { ApiError } from '../middleware/error';
import type { AppConfig } from '../config';
import type { ActionFilter, Store } from '../repositories/interfaces';
import type { AuthUser, IntegrationAction } from '../types/domain';
import type { AuditService } from './audit';

/**
 * Integration actions — the ONLY path to external side effects.
 * COMPLIANCE-CRITICAL — see docs/AI_COMPLIANCE_GUARDRAILS.md.
 *
 * Lifecycle: proposed → (gate) → executing → executed | failed.
 * The gate requires an ai_approvals row with decision='approved' whose
 * output is not REJECTED. This is enforced here AND by a database trigger
 * (enforce_action_approval), so a buggy future endpoint cannot bypass it.
 *
 * In this milestone execution is additionally disabled by default
 * (INTEGRATION_EXECUTION_ENABLED=false): actions can be proposed and
 * approved but nothing leaves the system. When enabled, only the 'noop'
 * target (a simulator used by tests) is implemented.
 */
export class ActionService {
  constructor(
    private store: Store,
    private audit: AuditService,
    private config: AppConfig,
  ) {}

  async propose(
    actor: AuthUser,
    taskId: string,
    body: {
      action_type: string;
      target_system: string;
      request_payload_json: Record<string, unknown>;
      approval_id?: string | null;
    },
  ): Promise<IntegrationAction> {
    const task = await this.store.tasks.get(taskId);
    if (!task) throw ApiError.notFound('Task');
    if (body.approval_id) {
      const approval = await this.store.approvals.get(body.approval_id);
      if (!approval) throw ApiError.badRequest('approval_id does not exist');
    }
    const action = await this.store.actions.create({
      task_id: taskId,
      approval_id: body.approval_id ?? null,
      action_type: body.action_type,
      target_system: body.target_system,
      status: 'proposed',
      request_payload_json: body.request_payload_json,
      response_payload_json: null,
    });
    await this.audit.record('action.proposed', {
      taskId,
      actor: actor.email,
      payload: {
        action_id: action.id,
        action_type: action.action_type,
        target_system: action.target_system,
        approval_id: action.approval_id,
      },
    });
    return action;
  }

  async get(id: string): Promise<IntegrationAction> {
    const action = await this.store.actions.get(id);
    if (!action) throw ApiError.notFound('Integration action');
    return action;
  }

  list(filter: ActionFilter) {
    return this.store.actions.list(filter);
  }

  /**
   * THE GATE. Refuses to execute unless:
   *  1. the action references an approval,
   *  2. that approval's decision is 'approved',
   *  3. the approved output has not been rejected since,
   *  4. execution is globally enabled.
   * Every refusal is itself audited.
   */
  async execute(actor: AuthUser, actionId: string): Promise<IntegrationAction> {
    const action = await this.get(actionId);
    if (action.status !== 'proposed' && action.status !== 'approved') {
      throw ApiError.conflict('ACTION_NOT_EXECUTABLE', `Action is ${action.status}`);
    }

    const block = async (code: string, message: string, status = 403) => {
      await this.audit.record('action.blocked', {
        taskId: action.task_id,
        actor: actor.email,
        payload: { action_id: actionId, reason: code },
      });
      throw new ApiError(status, code, message);
    };

    if (!action.approval_id) {
      await block('APPROVAL_REQUIRED', 'Integration actions cannot execute without a human approval');
    }
    const approval = await this.store.approvals.get(action.approval_id!);
    if (!approval || approval.decision !== 'approved') {
      await block(
        'APPROVAL_REQUIRED',
        `Referenced approval is ${approval ? approval.decision : 'missing'} — execution refused`,
      );
    }
    const output = await this.store.outputs.get(approval!.output_id);
    if (!output || output.review_status === 'REJECTED') {
      await block('OUTPUT_REJECTED', 'The reviewed output was rejected — execution refused');
    }
    if (output!.review_status !== 'FINALIZED' && output!.review_status !== 'ACTION_SENT') {
      await block(
        'OUTPUT_NOT_FINALIZED',
        `Output must be FINALIZED before actions execute (currently ${output!.review_status})`,
      );
    }
    if (!this.config.integrationExecutionEnabled) {
      await block(
        'EXECUTION_DISABLED',
        'Integration execution is disabled in this environment (INTEGRATION_EXECUTION_ENABLED=false)',
        409,
      );
    }
    if (action.target_system !== 'noop') {
      await block(
        'TARGET_NOT_IMPLEMENTED',
        `No execution adapter exists for '${action.target_system}' in this milestone`,
        501,
      );
    }

    // Gate passed: atomically claim the row (FOR UPDATE serializes concurrent
    // execute calls) and run the simulated no-op adapter. Everything in here
    // commits or rolls back together.
    return this.store.withTransaction(async (tx) => {
      const locked = await tx.actions.getForUpdate(actionId);
      if (!locked || (locked.status !== 'proposed' && locked.status !== 'approved')) {
        throw ApiError.conflict(
          'ACTION_ALREADY_EXECUTED',
          `Action was already ${locked?.status ?? 'removed'} by another request`,
        );
      }
      await tx.actions.update(actionId, { status: 'executing' });
      await tx.outputs.setReviewStatus(output!.id, 'ACTION_SENT');
      const executed = (await tx.actions.update(actionId, {
        status: 'executed',
        response_payload_json: { simulated: true, executed_by: actor.email },
        completed_at: new Date().toISOString(),
      }))!;
      await tx.outputs.setReviewStatus(output!.id, 'ACTION_COMPLETED');
      await tx.audit.append({
        task_id: action.task_id,
        actor_user_id: actor.email,
        event_type: 'action.executed',
        event_payload_json: {
          action_id: actionId,
          approval_id: action.approval_id,
          target_system: action.target_system,
          simulated: true,
        },
      });
      return executed;
    });
  }
}
