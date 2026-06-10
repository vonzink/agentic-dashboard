import { ApiError } from '../middleware/error';
import type { AppConfig } from '../config';
import type { OutputFilter, Store } from '../repositories/interfaces';
import type { AiOutput, Approval, AuthUser } from '../types/domain';
import { REVIEW_TRANSITIONS, type ReviewStatus } from '../types/statuses';
import type { AuditService } from './audit';

/**
 * The human-approval gate. COMPLIANCE-CRITICAL — see
 * docs/AI_COMPLIANCE_GUARDRAILS.md before changing anything here.
 *
 * Invariants:
 *  - Raw AI output (ai_outputs.content) is never mutated; the reviewer's
 *    version lives in ai_approvals.edited_final_content.
 *  - Every decision writes an audit event.
 *  - Review-status transitions follow REVIEW_TRANSITIONS; anything else 409s.
 */
export class ApprovalService {
  constructor(
    private store: Store,
    private audit: AuditService,
    private config: AppConfig,
  ) {}

  listOutputs(filter: OutputFilter) {
    return this.store.outputs.list(filter);
  }

  async getOutput(outputId: string) {
    const output = await this.store.outputs.get(outputId);
    if (!output) throw ApiError.notFound('Output');
    const [citations, approvals] = await Promise.all([
      this.store.citations.listByOutput(outputId),
      this.store.approvals.listByOutput(outputId),
    ]);
    return { ...output, citations, approvals };
  }

  async listOutputsByTask(taskId: string) {
    return this.store.outputs.listByTask(taskId);
  }

  async approve(
    actor: AuthUser,
    outputId: string,
    body: { reviewer_notes?: string | null; edited_final_content?: string | null },
  ) {
    return this.decide(actor, outputId, 'approved', 'APPROVED', body);
  }

  async reject(actor: AuthUser, outputId: string, body: { reviewer_notes: string }) {
    return this.decide(actor, outputId, 'rejected', 'REJECTED', body);
  }

  async requestChanges(actor: AuthUser, outputId: string, body: { reviewer_notes: string }) {
    return this.decide(actor, outputId, 'changes_requested', 'CHANGES_REQUESTED', body);
  }

  private async decide(
    actor: AuthUser,
    outputId: string,
    decision: Approval['decision'],
    targetStatus: ReviewStatus,
    body: { reviewer_notes?: string | null; edited_final_content?: string | null },
  ): Promise<{ approval: Approval; output: AiOutput }> {
    const output = await this.store.outputs.get(outputId);
    if (!output) throw ApiError.notFound('Output');
    this.assertTransition(output.review_status, targetStatus);

    const run = await this.store.runs.get(output.task_run_id);
    if (!run) throw ApiError.notFound('Run for output');
    const task = await this.store.tasks.get(run.task_id);

    if (this.config.requireDifferentReviewer && run.requested_by === actor.email) {
      throw ApiError.forbidden(
        'SELF_REVIEW_FORBIDDEN',
        'The person who requested the AI run may not review its output',
      );
    }

    // Decision + status change + audit event commit or roll back together.
    return this.store.withTransaction(async (tx) => {
      const approval = await tx.approvals.create({
        task_id: run.task_id,
        output_id: outputId,
        reviewed_by: actor.email,
        decision,
        reviewer_notes: body.reviewer_notes ?? null,
        // Stored separately from the raw AI output, by design.
        edited_final_content: body.edited_final_content ?? null,
      });
      const updated = (await tx.outputs.setReviewStatus(outputId, targetStatus))!;

      await tx.audit.append({
        task_id: run.task_id,
        company_id: task?.company_id ?? null,
        actor_user_id: actor.email,
        event_type: `output.${decision}`,
        event_payload_json: {
          output_id: outputId,
          approval_id: approval.id,
          run_id: run.id,
          prompt_version: run.prompt_version,
          was_edited: body.edited_final_content != null,
          reviewer_notes: body.reviewer_notes ?? null,
        },
      });

      if (decision === 'changes_requested') {
        await tx.tasks.update(run.task_id, { status: 'changes_requested' });
      }
      return { approval, output: updated };
    });
  }

  /** Locks the final content. Requires an approved approval on the output. */
  async finalize(actor: AuthUser, outputId: string): Promise<{ output: AiOutput }> {
    const output = await this.store.outputs.get(outputId);
    if (!output) throw ApiError.notFound('Output');
    this.assertTransition(output.review_status, 'FINALIZED');

    const approvals = await this.store.approvals.listByOutput(outputId);
    const latest = approvals[0];
    if (!latest || latest.decision !== 'approved') {
      throw ApiError.forbidden(
        'APPROVAL_REQUIRED',
        'Output cannot be finalized without an approved review',
      );
    }
    const run = await this.store.runs.get(output.task_run_id);
    const task = run ? await this.store.tasks.get(run.task_id) : null;
    return this.store.withTransaction(async (tx) => {
      const updated = (await tx.outputs.setReviewStatus(outputId, 'FINALIZED'))!;
      await tx.audit.append({
        task_id: run?.task_id ?? null,
        company_id: task?.company_id ?? null,
        actor_user_id: actor.email,
        event_type: 'output.finalized',
        event_payload_json: {
          output_id: outputId,
          approval_id: latest.id,
          final_content_source: latest.edited_final_content != null ? 'edited' : 'raw_output',
        },
      });
      if (run) await tx.tasks.update(run.task_id, { status: 'completed' });
      return { output: updated };
    });
  }

  private assertTransition(from: ReviewStatus, to: ReviewStatus) {
    if (!REVIEW_TRANSITIONS[from]?.includes(to)) {
      throw ApiError.conflict(
        'INVALID_REVIEW_TRANSITION',
        `Cannot move output from ${from} to ${to}`,
      );
    }
  }
}
