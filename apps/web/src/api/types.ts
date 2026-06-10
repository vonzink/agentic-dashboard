// Shared API types — field names mirror the backend JSON contract (snake_case).

export type Role = 'viewer' | 'operator' | 'reviewer' | 'admin';

export interface DevUser {
  email: string;
  role: Role;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export type TaskType =
  | 'condition_response'
  | 'borrower_email'
  | 'document_checklist'
  | 'sop_lookup'
  | 'income_review'
  | 'asset_review'
  | 'credit_review'
  | 'title_insurance_review'
  | 'website_qa'
  | 'general';

export type TaskStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_review'
  | 'changes_requested'
  | 'completed'
  | 'archived'
  | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  task_type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  created_by: string;
  assigned_to: string | null;
  borrower_reference: string | null;
  loan_reference: string | null;
  due_at: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type InputType =
  | 'condition_text'
  | 'borrower_context'
  | 'question'
  | 'source_snippet'
  | 'document_reference'
  | 'scenario'
  | 'instruction'
  | 'other';

export interface TaskInput {
  id: string;
  task_id: string;
  input_type: InputType;
  content: string;
  source_document_id: string | null;
  created_at: string;
}

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskRun {
  id: string;
  task_id: string;
  workflow_name: string;
  langgraph_run_id: string | null;
  model_provider: string;
  model_name: string;
  prompt_version: string;
  status: RunStatus;
  requested_by: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  token_input_count: number | null;
  token_output_count: number | null;
  estimated_cost: string | null;
  created_at: string;
}

export type OutputType =
  | 'draft_response'
  | 'email_draft'
  | 'checklist'
  | 'answer'
  | 'summary'
  | 'classification'
  | 'proposed_action'
  | 'other';

export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';

export type ReviewStatus =
  | 'DRAFT'
  | 'AI_GENERATED'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED'
  | 'FINALIZED'
  | 'ACTION_SENT'
  | 'ACTION_COMPLETED';

export interface Citation {
  id: string;
  output_id: string;
  document_id: string | null;
  chunk_id: string | null;
  citation_text: string;
  source_label: string;
  page_number: number | null;
  created_at: string;
}

export interface StructuredCitation {
  source_label: string;
  citation_text: string;
  page_number?: number;
}

export interface StructuredOutputBase {
  summary?: string;
  citations?: StructuredCitation[];
  confidence_label?: ConfidenceLabel;
  requires_human_review?: boolean;
  warnings?: string[];
  recommended_next_steps?: string[];
  // condition_response_draft
  missing_items?: string[];
  draft_response?: string;
  // borrower_email_draft
  email_subject?: string;
  email_body?: string;
  checklist?: string[];
  caveats?: string[];
  // document_checklist_builder
  documents?: { name: string; reason: string; when_needed: string; required: boolean }[];
  // sop_lookup_answer
  answer?: string;
}

export interface AiOutput {
  id: string;
  task_run_id: string;
  output_type: OutputType;
  content: string;
  structured_json: StructuredOutputBase | null;
  confidence_label: ConfidenceLabel;
  requires_human_review: boolean;
  review_status: ReviewStatus;
  created_at: string;
  citations?: Citation[];
}

export type ApprovalDecision = 'approved' | 'rejected' | 'changes_requested';

export interface Approval {
  id: string;
  task_id: string;
  output_id: string;
  reviewed_by: string;
  decision: ApprovalDecision;
  reviewer_notes: string | null;
  edited_final_content: string | null;
  reviewed_at: string;
}

export interface AuditEvent {
  id: number;
  task_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  event_payload_json: Record<string, unknown>;
  created_at: string;
}

export type ExtractionStatus = 'pending' | 'not_applicable' | 'succeeded' | 'failed' | 'manual';

export type DocumentType =
  | 'sop'
  | 'guideline'
  | 'condition_sheet'
  | 'paystub'
  | 'bank_statement'
  | 'tax_return'
  | 'credit_report'
  | 'title_doc'
  | 'insurance_doc'
  | 'correspondence'
  | 'manual_snippet'
  | 'other';

export type Classification = 'public' | 'internal' | 'borrower_pii';

export interface SourceDocument {
  id: string;
  filename: string;
  file_type: string | null;
  s3_bucket: string | null;
  s3_key: string | null;
  text_extraction_status: ExtractionStatus;
  document_type: DocumentType;
  classification: Classification;
  created_by: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface SourceChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  section_label: string | null;
  embedding_id: string | null;
  created_at: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  version: number;
  task_type: TaskType;
  system_prompt: string;
  user_prompt_template: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface WorkflowConfig {
  id: string;
  workflow_name: string;
  task_type: TaskType;
  requires_approval: boolean;
  allowed_tools_json: unknown[];
  model_config_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type WorkflowInfo = WorkflowConfig & { implemented: boolean; description: string };

export type ActionStatus =
  | 'proposed'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled';

export interface IntegrationAction {
  id: string;
  task_id: string;
  approval_id: string | null;
  action_type: string;
  target_system: string;
  status: ActionStatus;
  request_payload_json: Record<string, unknown>;
  response_payload_json: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

// ----- composite response shapes -----

export interface HealthResponse {
  status: 'ok';
  db: 'up' | 'down' | 'skipped';
  provider: { name: string; configured: boolean };
  version: string;
}

export interface IntegrationStatus {
  name: string;
  status: 'not_configured' | 'ok' | 'error';
  detail: string;
}

export type TaskDetail = Task & {
  inputs: TaskInput[];
  runs: TaskRun[];
  outputs: AiOutput[];
  approvals: Approval[];
  actions: IntegrationAction[];
};

export type OutputDetail = AiOutput & { citations: Citation[]; approvals: Approval[] };

export type ReviewQueueItem = AiOutput & {
  task_id: string;
  task_title: string;
  workflow_name: string;
};

export type DocumentDetail = SourceDocument & { chunks: SourceChunk[] };

export interface RunResponse {
  run: TaskRun;
  outputs: AiOutput[];
}

export interface ApprovalResponse {
  approval: Approval;
  output: AiOutput;
}

/** GET /search result item (retrieval over embedded chunks). */
export interface SearchHit {
  chunk_id: string;
  document_id: string;
  source_label: string;
  content: string;
  page_number: number | null;
  score: number;
}
