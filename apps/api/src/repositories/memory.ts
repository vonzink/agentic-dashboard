import { randomUUID } from 'node:crypto';
import type {
  AiOutput,
  Approval,
  Company,
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
  ActionFilter,
  AuditFilter,
  EmbeddedChunk,
  NewCompany,
  NewAiOutput,
  NewApproval,
  NewAuditEvent,
  NewCitation,
  NewIntegrationAction,
  NewPromptTemplate,
  NewSourceChunk,
  NewSourceDocument,
  NewTask,
  NewTaskInput,
  NewTaskRun,
  NewWorkflowConfig,
  OutputFilter,
  OutputListItem,
  Page,
  Store,
  TaskFilter,
  UsageSummary,
} from './interfaces';

const now = () => new Date().toISOString();

function paginate<T>(rows: T[], { page, pageSize }: Page): Paginated<T> {
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: rows.length,
  };
}

const byCreatedDesc = <T extends { created_at: string }>(a: T, b: T) =>
  b.created_at.localeCompare(a.created_at);

/**
 * In-memory Store used by the test suite and by DB-less local mode
 * (no DATABASE_URL). Mirrors PgStore behavior, including audit
 * append-only semantics (no update/delete methods exist at all).
 */
export class MemoryStore implements Store {
  private companiesById = new Map<string, Company>();
  private tasksById = new Map<string, Task>();
  private inputsById = new Map<string, TaskInput>();
  private runsById = new Map<string, TaskRun>();
  private outputsById = new Map<string, AiOutput>();
  private approvalsById = new Map<string, Approval>();
  private auditRows: AuditEvent[] = [];
  private auditSeq = 0;
  private documentsById = new Map<string, SourceDocument>();
  private chunksById = new Map<string, SourceChunk>();
  private embeddingsByChunk = new Map<string, { model: string; embedding: number[] }>();
  private citationsById = new Map<string, Citation>();
  private promptsById = new Map<string, PromptTemplate>();
  private configsByName = new Map<string, WorkflowConfig>();
  private actionsById = new Map<string, IntegrationAction>();

  companies = {
    create: async (c: NewCompany): Promise<Company> => {
      if ([...this.companiesById.values()].some((x) => x.slug === c.slug || x.name === c.name)) {
        throw new Error('duplicate company name/slug');
      }
      const row: Company = { ...c, id: randomUUID(), created_at: now() };
      this.companiesById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.companiesById.get(id) ?? null,
    getBySlug: async (slug: string) =>
      [...this.companiesById.values()].find((c) => c.slug === slug) ?? null,
    list: async () =>
      [...this.companiesById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    update: async (id: string, patch: Partial<Company>) => {
      const existing = this.companiesById.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id };
      this.companiesById.set(id, updated);
      return updated;
    },
  };

  tasks = {
    create: async (t: NewTask): Promise<Task> => {
      const row: Task = { ...t, id: randomUUID(), created_at: now(), updated_at: now() };
      this.tasksById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.tasksById.get(id) ?? null,
    update: async (id: string, patch: Partial<NewTask>) => {
      const existing = this.tasksById.get(id);
      if (!existing) return null;
      const updated: Task = { ...existing, ...patch, id, updated_at: now() };
      this.tasksById.set(id, updated);
      return updated;
    },
    list: async (filter: TaskFilter) => {
      const search = filter.search?.toLowerCase();
      const rows = [...this.tasksById.values()]
        .filter(
          (t) =>
            (!filter.company_id || t.company_id === filter.company_id) &&
            (!filter.status || t.status === filter.status) &&
            (!filter.task_type || t.task_type === filter.task_type) &&
            (!filter.priority || t.priority === filter.priority) &&
            (!filter.assigned_to || t.assigned_to === filter.assigned_to) &&
            (!search ||
              t.title.toLowerCase().includes(search) ||
              (t.borrower_reference ?? '').toLowerCase().includes(search) ||
              (t.loan_reference ?? '').toLowerCase().includes(search)),
        )
        .sort(byCreatedDesc);
      return paginate(rows, filter);
    },
  };

  taskInputs = {
    create: async (i: NewTaskInput): Promise<TaskInput> => {
      const row: TaskInput = { ...i, id: randomUUID(), created_at: now() };
      this.inputsById.set(row.id, row);
      return row;
    },
    listByTask: async (taskId: string) =>
      [...this.inputsById.values()]
        .filter((i) => i.task_id === taskId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };

  runs = {
    create: async (r: NewTaskRun): Promise<TaskRun> => {
      const row: TaskRun = { ...r, id: randomUUID(), created_at: now() };
      this.runsById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.runsById.get(id) ?? null,
    update: async (id: string, patch: Partial<TaskRun>) => {
      const existing = this.runsById.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id };
      this.runsById.set(id, updated);
      return updated;
    },
    listByTask: async (taskId: string) =>
      [...this.runsById.values()].filter((r) => r.task_id === taskId).sort(byCreatedDesc),
    usageSummary: async (sinceIso: string, companyId?: string): Promise<UsageSummary> => {
      const rows = [...this.runsById.values()].filter(
        (r) =>
          r.created_at >= sinceIso &&
          (!companyId || this.tasksById.get(r.task_id)?.company_id === companyId),
      );
      const agg = () => ({ runs: 0, tokens_in: 0, tokens_out: 0, cost: 0 });
      const totals = agg();
      const byWorkflow = new Map<string, ReturnType<typeof agg>>();
      const byDay = new Map<string, { runs: number; cost: number }>();
      for (const r of rows) {
        const cost = Number(r.estimated_cost ?? 0);
        totals.runs += 1;
        totals.tokens_in += r.token_input_count ?? 0;
        totals.tokens_out += r.token_output_count ?? 0;
        totals.cost += cost;
        const w = byWorkflow.get(r.workflow_name) ?? agg();
        w.runs += 1;
        w.tokens_in += r.token_input_count ?? 0;
        w.tokens_out += r.token_output_count ?? 0;
        w.cost += cost;
        byWorkflow.set(r.workflow_name, w);
        const day = r.created_at.slice(0, 10);
        const d = byDay.get(day) ?? { runs: 0, cost: 0 };
        d.runs += 1;
        d.cost += cost;
        byDay.set(day, d);
      }
      return {
        since: sinceIso,
        totals: {
          runs: totals.runs,
          tokens_in: totals.tokens_in,
          tokens_out: totals.tokens_out,
          estimated_cost: totals.cost.toFixed(6),
        },
        by_workflow: [...byWorkflow.entries()]
          .map(([workflow_name, w]) => ({
            workflow_name,
            runs: w.runs,
            tokens_in: w.tokens_in,
            tokens_out: w.tokens_out,
            estimated_cost: w.cost.toFixed(6),
          }))
          .sort((a, b) => Number(b.estimated_cost) - Number(a.estimated_cost) || b.runs - a.runs),
        by_day: [...byDay.entries()]
          .map(([day, d]) => ({ day, runs: d.runs, estimated_cost: d.cost.toFixed(6) }))
          .sort((a, b) => a.day.localeCompare(b.day)),
      };
    },
  };

  outputs = {
    create: async (o: NewAiOutput): Promise<AiOutput> => {
      const row: AiOutput = { ...o, id: randomUUID(), created_at: now() };
      this.outputsById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.outputsById.get(id) ?? null,
    setReviewStatus: async (id: string, status: AiOutput['review_status']) => {
      const existing = this.outputsById.get(id);
      if (!existing) return null;
      const updated = { ...existing, review_status: status };
      this.outputsById.set(id, updated);
      return updated;
    },
    listByRun: async (runId: string) =>
      [...this.outputsById.values()].filter((o) => o.task_run_id === runId).sort(byCreatedDesc),
    listByTask: async (taskId: string) => {
      const runIds = new Set(
        [...this.runsById.values()].filter((r) => r.task_id === taskId).map((r) => r.id),
      );
      return [...this.outputsById.values()]
        .filter((o) => runIds.has(o.task_run_id))
        .sort(byCreatedDesc);
    },
    list: async (filter: OutputFilter) => {
      const rows: OutputListItem[] = [...this.outputsById.values()]
        .filter((o) => !filter.review_status || o.review_status === filter.review_status)
        .sort(byCreatedDesc)
        .map((o) => {
          const run = this.runsById.get(o.task_run_id);
          const task = run ? this.tasksById.get(run.task_id) : undefined;
          return {
            ...o,
            task_id: run?.task_id ?? '',
            task_title: task?.title ?? '',
            workflow_name: run?.workflow_name ?? '',
          };
        });
      return paginate(rows, filter);
    },
  };

  approvals = {
    create: async (a: NewApproval): Promise<Approval> => {
      const row: Approval = { ...a, id: randomUUID(), reviewed_at: now() };
      this.approvalsById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.approvalsById.get(id) ?? null,
    listByOutput: async (outputId: string) =>
      [...this.approvalsById.values()]
        .filter((a) => a.output_id === outputId)
        .sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at)),
    listByTask: async (taskId: string) =>
      [...this.approvalsById.values()]
        .filter((a) => a.task_id === taskId)
        .sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at)),
    listDecisionsSince: async (sinceIso: string, companyId?: string) =>
      [...this.approvalsById.values()]
        .filter(
          (a) =>
            a.reviewed_at >= sinceIso &&
            (!companyId || this.tasksById.get(a.task_id)?.company_id === companyId),
        )
        .flatMap((a) => {
          const output = this.outputsById.get(a.output_id);
          if (!output) return [];
          const run = this.runsById.get(output.task_run_id);
          return [
            {
              decision: a.decision,
              reviewed_at: a.reviewed_at,
              edited_final_content: a.edited_final_content,
              output_content: output.content,
              workflow_name: run?.workflow_name ?? '',
            },
          ];
        }),
  };

  audit = {
    append: async (e: NewAuditEvent): Promise<AuditEvent> => {
      const row: AuditEvent = { ...e, id: ++this.auditSeq, created_at: now() };
      this.auditRows.push(row);
      return row;
    },
    list: async (filter: AuditFilter) => {
      const rows = this.auditRows
        .filter(
          (e) =>
            (!filter.company_id || e.company_id === filter.company_id) &&
            (!filter.event_type || e.event_type === filter.event_type) &&
            (!filter.actor || e.actor_user_id === filter.actor) &&
            (!filter.task_id || e.task_id === filter.task_id),
        )
        .slice()
        .reverse();
      return paginate(rows, filter);
    },
    listByTask: async (taskId: string) =>
      this.auditRows.filter((e) => e.task_id === taskId).slice().reverse(),
  };

  documents = {
    create: async (d: NewSourceDocument): Promise<SourceDocument> => {
      const row: SourceDocument = { ...d, id: randomUUID(), created_at: now() };
      this.documentsById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.documentsById.get(id) ?? null,
    update: async (id: string, patch: Partial<SourceDocument>) => {
      const existing = this.documentsById.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id };
      this.documentsById.set(id, updated);
      return updated;
    },
    list: async (filter: Page & { document_type?: string; company_id?: string }) => {
      const rows = [...this.documentsById.values()]
        .filter(
          (d) =>
            (!filter.document_type || d.document_type === filter.document_type) &&
            (!filter.company_id || d.company_id === filter.company_id),
        )
        .sort(byCreatedDesc);
      return paginate(rows, filter);
    },
  };

  chunks = {
    create: async (c: NewSourceChunk): Promise<SourceChunk> => {
      const row: SourceChunk = { ...c, id: randomUUID(), created_at: now() };
      this.chunksById.set(row.id, row);
      return row;
    },
    listByDocument: async (documentId: string) =>
      [...this.chunksById.values()]
        .filter((c) => c.document_id === documentId)
        .sort((a, b) => a.chunk_index - b.chunk_index),
    getMany: async (ids: string[]) =>
      ids.map((id) => this.chunksById.get(id)).filter((c): c is SourceChunk => !!c),
    nextIndex: async (documentId: string) => {
      const indexes = [...this.chunksById.values()]
        .filter((c) => c.document_id === documentId)
        .map((c) => c.chunk_index);
      return indexes.length ? Math.max(...indexes) + 1 : 0;
    },
    setEmbedding: async (chunkId: string, model: string, embedding: number[]) => {
      this.embeddingsByChunk.set(chunkId, { model, embedding });
    },
    listEmbedded: async (model: string, companyId?: string): Promise<EmbeddedChunk[]> => {
      const out: EmbeddedChunk[] = [];
      for (const [chunkId, e] of this.embeddingsByChunk) {
        if (e.model !== model) continue;
        const c = this.chunksById.get(chunkId);
        if (!c) continue;
        if (companyId && this.documentsById.get(c.document_id)?.company_id !== companyId) continue;
        out.push({
          chunk_id: c.id,
          document_id: c.document_id,
          content: c.content,
          section_label: c.section_label,
          page_number: c.page_number,
          embedding: e.embedding,
        });
      }
      return out;
    },
  };

  citations = {
    createMany: async (rows: NewCitation[]): Promise<Citation[]> => {
      return rows.map((r) => {
        const row: Citation = { ...r, id: randomUUID(), created_at: now() };
        this.citationsById.set(row.id, row);
        return row;
      });
    },
    listByOutput: async (outputId: string) =>
      [...this.citationsById.values()].filter((c) => c.output_id === outputId),
  };

  prompts = {
    create: async (p: NewPromptTemplate): Promise<PromptTemplate> => {
      if (p.is_active) {
        for (const [id, row] of this.promptsById) {
          if (row.name === p.name && row.is_active) {
            this.promptsById.set(id, { ...row, is_active: false });
          }
        }
      }
      const row: PromptTemplate = { ...p, id: randomUUID(), created_at: now() };
      this.promptsById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.promptsById.get(id) ?? null,
    list: async (filter: { name?: string; task_type?: string }) =>
      [...this.promptsById.values()]
        .filter(
          (p) =>
            (!filter.name || p.name === filter.name) &&
            (!filter.task_type || p.task_type === filter.task_type),
        )
        .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version),
    getActiveByName: async (name: string) =>
      [...this.promptsById.values()].find((p) => p.name === name && p.is_active) ?? null,
    maxVersion: async (name: string) =>
      Math.max(0, ...[...this.promptsById.values()].filter((p) => p.name === name).map((p) => p.version)),
    setActive: async (id: string, active: boolean) => {
      const existing = this.promptsById.get(id);
      if (!existing) return null;
      if (active) {
        for (const [otherId, row] of this.promptsById) {
          if (row.name === existing.name && row.is_active && otherId !== id) {
            this.promptsById.set(otherId, { ...row, is_active: false });
          }
        }
      }
      const updated = { ...existing, is_active: active };
      this.promptsById.set(id, updated);
      return updated;
    },
  };

  workflowConfigs = {
    upsert: async (c: NewWorkflowConfig): Promise<WorkflowConfig> => {
      const existing = this.configsByName.get(c.workflow_name);
      const row: WorkflowConfig = existing
        ? { ...existing, ...c, updated_at: now() }
        : { ...c, id: randomUUID(), created_at: now(), updated_at: now() };
      this.configsByName.set(c.workflow_name, row);
      return row;
    },
    getByName: async (workflowName: string) => this.configsByName.get(workflowName) ?? null,
    list: async () =>
      [...this.configsByName.values()].sort((a, b) =>
        a.workflow_name.localeCompare(b.workflow_name),
      ),
  };

  actions = {
    create: async (a: NewIntegrationAction): Promise<IntegrationAction> => {
      const row: IntegrationAction = {
        ...a,
        id: randomUUID(),
        created_at: now(),
        completed_at: null,
      };
      this.actionsById.set(row.id, row);
      return row;
    },
    get: async (id: string) => this.actionsById.get(id) ?? null,
    getForUpdate: async (id: string) => this.actionsById.get(id) ?? null,
    update: async (id: string, patch: Partial<IntegrationAction>) => {
      const existing = this.actionsById.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id };
      this.actionsById.set(id, updated);
      return updated;
    },
    list: async (filter: ActionFilter) => {
      const rows = [...this.actionsById.values()]
        .filter((a) => !filter.status || a.status === filter.status)
        .sort(byCreatedDesc);
      return paginate(rows, filter);
    },
    listByTask: async (taskId: string) =>
      [...this.actionsById.values()].filter((a) => a.task_id === taskId).sort(byCreatedDesc),
  };

  /** No real transactionality in memory: JS is single-threaded and tests
   * don't need rollback, only the same call shape as PgStore. */
  async withTransaction<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async ping(): Promise<'up' | 'down' | 'skipped'> {
    return 'skipped';
  }
}
