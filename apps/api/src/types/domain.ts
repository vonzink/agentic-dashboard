import type {
  ActionStatus,
  ApprovalDecision,
  Classification,
  ConfidenceLabel,
  DocumentType,
  ExtractionStatus,
  InputType,
  OutputType,
  ReviewStatus,
  RunStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from './statuses';

/** Timestamps are ISO-8601 strings at the API boundary. */
export interface Company {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  /** Monthly AI spend budget in USD (numeric string); null = no budget. */
  monthly_budget: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  task_type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  company_id: string;
  created_by: string;
  assigned_to: string | null;
  borrower_reference: string | null;
  loan_reference: string | null;
  due_at: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskInput {
  id: string;
  task_id: string;
  input_type: InputType;
  content: string;
  source_document_id: string | null;
  created_at: string;
}

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
  input_snapshot_json: Record<string, unknown>;
  created_at: string;
}

export interface AiOutput {
  id: string;
  task_run_id: string;
  output_type: OutputType;
  /** Raw AI text. Immutable — the reviewer's version lives on the approval. */
  content: string;
  structured_json: Record<string, unknown> | null;
  confidence_label: ConfidenceLabel;
  requires_human_review: boolean;
  review_status: ReviewStatus;
  created_at: string;
}

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
  company_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  event_payload_json: Record<string, unknown>;
  created_at: string;
}

export interface SourceDocument {
  id: string;
  filename: string;
  file_type: string | null;
  s3_bucket: string | null;
  s3_key: string | null;
  text_extraction_status: ExtractionStatus;
  document_type: DocumentType;
  classification: Classification;
  company_id: string;
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

export interface PromptTemplate {
  id: string;
  name: string;
  version: number;
  task_type: string;
  system_prompt: string;
  user_prompt_template: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface WorkflowConfig {
  id: string;
  workflow_name: string;
  task_type: string;
  requires_approval: boolean;
  allowed_tools_json: unknown[];
  model_config_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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

export interface AuthUser {
  email: string;
  role: import('./statuses').Role;
}

/** A saved eval input for one workflow (synthetic content only). */
export interface EvalCase {
  id: string;
  workflow_name: string;
  name: string;
  input_json: {
    primary_text: string;
    source_text?: string | null;
    options?: Record<string, string>;
  };
  expectations_json: {
    contains?: string[];
    min_confidence?: ConfidenceLabel;
  };
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface EvalCaseResult {
  case_id: string;
  case_name: string;
  passed: boolean;
  failures: string[];
  confidence: ConfidenceLabel | null;
  content_preview: string;
}

/** One execution of a workflow's eval set against a prompt version. */
export interface EvalRun {
  id: string;
  workflow_name: string;
  prompt_version: string;
  model_provider: string;
  model_name: string;
  passed_count: number;
  failed_count: number;
  results_json: EvalCaseResult[];
  created_by: string;
  created_at: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
