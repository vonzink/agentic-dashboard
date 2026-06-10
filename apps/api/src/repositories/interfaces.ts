import type {
  AiOutput,
  Approval,
  AuditEvent,
  Citation,
  IntegrationAction,
  Paginated,
  PromptTemplate,
  SourceChunk,
  SourceDocument,
  Task,
  TaskInput,
  TaskRun,
  WorkflowConfig,
} from '../types/domain';
import type {
  ActionStatus,
  ReviewStatus,
  RunStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../types/statuses';

export interface Page {
  page: number;
  pageSize: number;
}

export interface TaskFilter extends Page {
  status?: TaskStatus;
  task_type?: TaskType;
  priority?: TaskPriority;
  assigned_to?: string;
  search?: string;
}

export interface OutputFilter extends Page {
  review_status?: ReviewStatus;
}

export interface AuditFilter extends Page {
  event_type?: string;
  actor?: string;
  task_id?: string;
}

export interface ActionFilter extends Page {
  status?: ActionStatus;
}

export type NewTask = Omit<Task, 'id' | 'created_at' | 'updated_at'>;
export type NewTaskInput = Omit<TaskInput, 'id' | 'created_at'>;
export type NewTaskRun = Omit<TaskRun, 'id' | 'created_at'>;
export type NewAiOutput = Omit<AiOutput, 'id' | 'created_at'>;
export type NewApproval = Omit<Approval, 'id' | 'reviewed_at'>;
export type NewAuditEvent = Omit<AuditEvent, 'id' | 'created_at'>;
export type NewSourceDocument = Omit<SourceDocument, 'id' | 'created_at'>;
export type NewSourceChunk = Omit<SourceChunk, 'id' | 'created_at'>;
export type NewCitation = Omit<Citation, 'id' | 'created_at'>;
export type NewPromptTemplate = Omit<PromptTemplate, 'id' | 'created_at'>;
export type NewWorkflowConfig = Omit<WorkflowConfig, 'id' | 'created_at' | 'updated_at'>;
export type NewIntegrationAction = Omit<IntegrationAction, 'id' | 'created_at' | 'completed_at'>;

/** Aggregated AI usage/cost figures (PRD: AI cost monitoring). */
export interface UsageSummary {
  since: string;
  totals: { runs: number; tokens_in: number; tokens_out: number; estimated_cost: string };
  by_workflow: {
    workflow_name: string;
    runs: number;
    tokens_in: number;
    tokens_out: number;
    estimated_cost: string;
  }[];
  by_day: { day: string; runs: number; estimated_cost: string }[];
}

/** A chunk + its retrieval vector (kept off the SourceChunk API type). */
export interface EmbeddedChunk {
  chunk_id: string;
  document_id: string;
  content: string;
  section_label: string | null;
  page_number: number | null;
  embedding: number[];
}

/** Output joined with task context for the approval-center list. */
export type OutputListItem = AiOutput & {
  task_id: string;
  task_title: string;
  workflow_name: string;
};

/**
 * Data access boundary. Two implementations:
 *  - PgStore (production, Postgres)
 *  - MemoryStore (tests / DB-less local mode)
 *
 * The audit repository deliberately exposes only `append` — the audit log
 * is immutable by construction at every layer.
 */
export interface Store {
  tasks: {
    create(t: NewTask): Promise<Task>;
    get(id: string): Promise<Task | null>;
    update(id: string, patch: Partial<NewTask>): Promise<Task | null>;
    list(filter: TaskFilter): Promise<Paginated<Task>>;
  };
  taskInputs: {
    create(i: NewTaskInput): Promise<TaskInput>;
    listByTask(taskId: string): Promise<TaskInput[]>;
  };
  runs: {
    create(r: NewTaskRun): Promise<TaskRun>;
    get(id: string): Promise<TaskRun | null>;
    update(
      id: string,
      patch: Partial<
        Pick<
          TaskRun,
          | 'status'
          | 'started_at'
          | 'completed_at'
          | 'error_message'
          | 'token_input_count'
          | 'token_output_count'
          | 'estimated_cost'
          | 'langgraph_run_id'
        >
      >,
    ): Promise<TaskRun | null>;
    listByTask(taskId: string): Promise<TaskRun[]>;
    /** Token/cost aggregates for runs created at/after `sinceIso`. */
    usageSummary(sinceIso: string): Promise<UsageSummary>;
  };
  outputs: {
    create(o: NewAiOutput): Promise<AiOutput>;
    get(id: string): Promise<AiOutput | null>;
    setReviewStatus(id: string, status: ReviewStatus): Promise<AiOutput | null>;
    listByRun(runId: string): Promise<AiOutput[]>;
    listByTask(taskId: string): Promise<AiOutput[]>;
    list(filter: OutputFilter): Promise<Paginated<OutputListItem>>;
  };
  approvals: {
    create(a: NewApproval): Promise<Approval>;
    listByOutput(outputId: string): Promise<Approval[]>;
    listByTask(taskId: string): Promise<Approval[]>;
    get(id: string): Promise<Approval | null>;
  };
  audit: {
    append(e: NewAuditEvent): Promise<AuditEvent>;
    list(filter: AuditFilter): Promise<Paginated<AuditEvent>>;
    listByTask(taskId: string): Promise<AuditEvent[]>;
  };
  documents: {
    create(d: NewSourceDocument): Promise<SourceDocument>;
    get(id: string): Promise<SourceDocument | null>;
    update(
      id: string,
      patch: Partial<Pick<SourceDocument, 'text_extraction_status'>>,
    ): Promise<SourceDocument | null>;
    list(filter: Page & { document_type?: string }): Promise<Paginated<SourceDocument>>;
  };
  chunks: {
    create(c: NewSourceChunk): Promise<SourceChunk>;
    listByDocument(documentId: string): Promise<SourceChunk[]>;
    getMany(ids: string[]): Promise<SourceChunk[]>;
    nextIndex(documentId: string): Promise<number>;
    /** Stores the retrieval vector for a chunk (per embedding model). */
    setEmbedding(chunkId: string, model: string, embedding: number[]): Promise<void>;
    /** All chunks embedded with `model` — the retrieval candidate set.
     * Embeddings are deliberately NOT on the SourceChunk domain type so
     * API payloads stay small. */
    listEmbedded(model: string): Promise<EmbeddedChunk[]>;
  };
  citations: {
    createMany(rows: NewCitation[]): Promise<Citation[]>;
    listByOutput(outputId: string): Promise<Citation[]>;
  };
  prompts: {
    create(p: NewPromptTemplate): Promise<PromptTemplate>;
    get(id: string): Promise<PromptTemplate | null>;
    list(filter: { name?: string; task_type?: string }): Promise<PromptTemplate[]>;
    getActiveByName(name: string): Promise<PromptTemplate | null>;
    maxVersion(name: string): Promise<number>;
    /** Activates one version and deactivates all other versions of the same name. */
    setActive(id: string, active: boolean): Promise<PromptTemplate | null>;
  };
  workflowConfigs: {
    upsert(c: NewWorkflowConfig): Promise<WorkflowConfig>;
    getByName(workflowName: string): Promise<WorkflowConfig | null>;
    list(): Promise<WorkflowConfig[]>;
  };
  actions: {
    create(a: NewIntegrationAction): Promise<IntegrationAction>;
    get(id: string): Promise<IntegrationAction | null>;
    /** Like get(), but row-locked when called inside withTransaction (pg). */
    getForUpdate(id: string): Promise<IntegrationAction | null>;
    update(
      id: string,
      patch: Partial<
        Pick<
          IntegrationAction,
          'status' | 'approval_id' | 'response_payload_json' | 'completed_at'
        >
      >,
    ): Promise<IntegrationAction | null>;
    list(filter: ActionFilter): Promise<Paginated<IntegrationAction>>;
    listByTask(taskId: string): Promise<IntegrationAction[]>;
  };
  /**
   * Runs `fn` atomically: PgStore wraps it in BEGIN/COMMIT on one client;
   * MemoryStore runs it directly (single-threaded, no rollback). Services
   * use this to couple compliance-critical writes with their audit events.
   */
  withTransaction<T>(fn: (s: Store) => Promise<T>): Promise<T>;
  /** Health probe. */
  ping(): Promise<'up' | 'down' | 'skipped'>;
}
