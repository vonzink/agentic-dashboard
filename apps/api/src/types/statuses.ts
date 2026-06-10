/**
 * Single source of truth for every status/enum value in the system.
 * These mirror the CHECK constraints in apps/api/migrations/0001_initial.sql —
 * change them together.
 */

export const TASK_TYPES = [
  'condition_response',
  'borrower_email',
  'document_checklist',
  'sop_lookup',
  'income_review',
  'asset_review',
  'credit_review',
  'title_insurance_review',
  'website_qa',
  'general',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  'open',
  'in_progress',
  'waiting_review',
  'changes_requested',
  'completed',
  'archived',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const INPUT_TYPES = [
  'condition_text',
  'borrower_context',
  'question',
  'source_snippet',
  'document_reference',
  'scenario',
  'instruction',
  'other',
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const OUTPUT_TYPES = [
  'draft_response',
  'email_draft',
  'checklist',
  'answer',
  'summary',
  'classification',
  'proposed_action',
  'other',
] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

export const CONFIDENCE_LABELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

/** Compliance review flow for AI outputs (docs/AI_COMPLIANCE_GUARDRAILS.md). */
export const REVIEW_STATUSES = [
  'DRAFT',
  'AI_GENERATED',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'FINALIZED',
  'ACTION_SENT',
  'ACTION_COMPLETED',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Allowed review-status transitions. Anything not listed is rejected. */
export const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  DRAFT: ['AI_GENERATED'],
  AI_GENERATED: ['NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  NEEDS_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'],
  APPROVED: ['FINALIZED', 'REJECTED'],
  REJECTED: [],
  CHANGES_REQUESTED: ['NEEDS_REVIEW', 'APPROVED', 'REJECTED'],
  FINALIZED: ['ACTION_SENT'],
  ACTION_SENT: ['ACTION_COMPLETED'],
  ACTION_COMPLETED: [],
};

export const APPROVAL_DECISIONS = ['approved', 'rejected', 'changes_requested'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const EXTRACTION_STATUSES = [
  'pending',
  'not_applicable',
  'succeeded',
  'failed',
  'manual',
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const DOCUMENT_TYPES = [
  'sop',
  'guideline',
  'condition_sheet',
  'paystub',
  'bank_statement',
  'tax_return',
  'credit_report',
  'title_doc',
  'insurance_doc',
  'correspondence',
  'manual_snippet',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const CLASSIFICATIONS = ['public', 'internal', 'borrower_pii'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const ACTION_STATUSES = [
  'proposed',
  'approved',
  'executing',
  'executed',
  'failed',
  'cancelled',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ROLES = ['viewer', 'operator', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Role hierarchy used by requireRole(); higher includes lower. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  reviewer: 2,
  admin: 3,
};
