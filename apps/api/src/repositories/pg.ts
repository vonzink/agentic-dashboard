import type { Pool, PoolClient } from 'pg';
import type {
  AiOutput,
  Approval,
  Company,
  AuditEvent,
  Citation,
  EvalCase,
  EvalRun,
  IntegrationAction,
  Paginated,
  Project,
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
  NewEvalCase,
  NewEvalRun,
  NewIntegrationAction,
  NewProject,
  NewPromptTemplate,
  NewSourceChunk,
  NewSourceDocument,
  NewTask,
  NewTaskInput,
  NewTaskRun,
  NewWorkflowConfig,
  OutputFilter,
  ProjectPatch,
  OutputListItem,
  Page,
  Store,
  TaskFilter,
  UsageSummary,
} from './interfaces';

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

/* Row mappers: convert pg Date objects to ISO strings; jsonb arrives parsed. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const mapCompany = (r: any): Company => ({ ...r, created_at: iso(r.created_at)! });
const mapTask = (r: any): Task => ({
  ...r,
  due_at: iso(r.due_at),
  created_at: iso(r.created_at)!,
  updated_at: iso(r.updated_at)!,
});
const mapInput = (r: any): TaskInput => ({ ...r, created_at: iso(r.created_at)! });
const mapRun = (r: any): TaskRun => ({
  ...r,
  started_at: iso(r.started_at),
  completed_at: iso(r.completed_at),
  created_at: iso(r.created_at)!,
});
const mapOutput = (r: any): AiOutput => ({ ...r, created_at: iso(r.created_at)! });
const mapApproval = (r: any): Approval => ({ ...r, reviewed_at: iso(r.reviewed_at)! });
const mapAudit = (r: any): AuditEvent => ({ ...r, created_at: iso(r.created_at)! });
const mapDocument = (r: any): SourceDocument => ({ ...r, created_at: iso(r.created_at)! });
// embedding columns stay out of API payloads (see chunks.listEmbedded)
const mapChunk = ({ embedding_json: _e, embedding_model: _m, ...r }: any): SourceChunk => ({
  ...r,
  created_at: iso(r.created_at)!,
});
const mapCitation = (r: any): Citation => ({ ...r, created_at: iso(r.created_at)! });
const mapPrompt = (r: any): PromptTemplate => ({ ...r, created_at: iso(r.created_at)! });
const mapConfig = (r: any): WorkflowConfig => ({
  ...r,
  created_at: iso(r.created_at)!,
  updated_at: iso(r.updated_at)!,
});
const mapAction = (r: any): IntegrationAction => ({
  ...r,
  created_at: iso(r.created_at)!,
  completed_at: iso(r.completed_at),
});
const mapEvalCase = (r: any): EvalCase => ({ ...r, created_at: iso(r.created_at)! });
const mapProject = (r: any): Project => ({
  ...r,
  created_at: iso(r.created_at)!,
  updated_at: iso(r.updated_at)!,
  github_synced_at: iso(r.github_synced_at),
});
const mapEvalRun = (r: any): EvalRun => ({ ...r, created_at: iso(r.created_at)! });
/* eslint-enable @typescript-eslint/no-explicit-any */

const limitOffset = ({ page, pageSize }: Page) =>
  ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

/** Builds a dynamic UPDATE ... SET from a patch object. */
function setClause(patch: Record<string, unknown>, startAt = 1) {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${startAt + i}`);
  const values = keys.map((k) => {
    const v = patch[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  });
  return { sets: sets.join(', '), values, next: startAt + keys.length };
}

export class PgStore implements Store {
  /**
   * `db` is the shared Pool normally, or a dedicated PoolClient when this
   * store instance lives inside withTransaction().
   */
  constructor(
    private db: Pool | PoolClient,
    private inTx = false,
  ) {}

  /**
   * Runs `fn` against a store bound to one client inside BEGIN/COMMIT.
   * Used by services to couple compliance-critical state changes with
   * their audit events atomically. Nested calls reuse the outer
   * transaction.
   */
  projects = {
    create: async (p: NewProject): Promise<Project> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_projects (company_id, name, description, github_repo, live_url,
           status, notes, github_meta_json, github_synced_at, github_readme_sha,
           readme_document_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          p.company_id, p.name, p.description, p.github_repo, p.live_url,
          p.status, p.notes,
          p.github_meta_json ? JSON.stringify(p.github_meta_json) : null,
          p.github_synced_at, p.github_readme_sha, p.readme_document_id, p.created_by,
        ],
      );
      return mapProject(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_projects WHERE id = $1', [id]);
      return rows[0] ? mapProject(rows[0]) : null;
    },
    list: async (companyId?: string) => {
      const { rows } = companyId
        ? await this.db.query(
            'SELECT * FROM ai_projects WHERE company_id = $1 ORDER BY name ASC',
            [companyId],
          )
        : await this.db.query('SELECT * FROM ai_projects ORDER BY name ASC');
      return rows.map(mapProject);
    },
    update: async (id: string, patch: ProjectPatch) => {
      if (!Object.keys(patch).length) return this.projects.get(id);
      const { sets, values, next } = setClause(patch as Record<string, unknown>);
      const { rows } = await this.db.query(
        `UPDATE ai_projects SET ${sets} WHERE id = $${next} RETURNING *`,
        [...values, id],
      );
      return rows[0] ? mapProject(rows[0]) : null;
    },
  };

  evalCases = {
    create: async (c: NewEvalCase): Promise<EvalCase> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_eval_cases (workflow_name, name, input_json, expectations_json,
           is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          c.workflow_name, c.name, JSON.stringify(c.input_json),
          JSON.stringify(c.expectations_json), c.is_active, c.created_by,
        ],
      );
      return mapEvalCase(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_eval_cases WHERE id = $1', [id]);
      return rows[0] ? mapEvalCase(rows[0]) : null;
    },
    list: async (workflowName?: string) => {
      const { rows } = workflowName
        ? await this.db.query(
            'SELECT * FROM ai_eval_cases WHERE workflow_name = $1 ORDER BY created_at DESC',
            [workflowName],
          )
        : await this.db.query('SELECT * FROM ai_eval_cases ORDER BY created_at DESC');
      return rows.map(mapEvalCase);
    },
    setActive: async (id: string, active: boolean) => {
      const { rows } = await this.db.query(
        'UPDATE ai_eval_cases SET is_active = $1 WHERE id = $2 RETURNING *',
        [active, id],
      );
      return rows[0] ? mapEvalCase(rows[0]) : null;
    },
  };

  evalRuns = {
    create: async (r: NewEvalRun): Promise<EvalRun> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_eval_runs (workflow_name, prompt_version, model_provider, model_name,
           passed_count, failed_count, results_json, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          r.workflow_name, r.prompt_version, r.model_provider, r.model_name,
          r.passed_count, r.failed_count, JSON.stringify(r.results_json), r.created_by,
        ],
      );
      return mapEvalRun(rows[0]);
    },
    list: async (workflowName?: string, limit = 20) => {
      const { rows } = workflowName
        ? await this.db.query(
            `SELECT * FROM ai_eval_runs WHERE workflow_name = $1
             ORDER BY created_at DESC LIMIT $2`,
            [workflowName, limit],
          )
        : await this.db.query('SELECT * FROM ai_eval_runs ORDER BY created_at DESC LIMIT $1', [limit]);
      return rows.map(mapEvalRun);
    },
  };

  async withTransaction<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    const client = await (this.db as Pool).connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgStore(client, true));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  companies = {
    create: async (c: NewCompany): Promise<Company> => {
      const { rows } = await this.db.query(
        'INSERT INTO ai_companies (name, slug, is_active, monthly_budget) VALUES ($1,$2,$3,$4) RETURNING *',
        [c.name, c.slug, c.is_active, c.monthly_budget],
      );
      return mapCompany(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_companies WHERE id = $1', [id]);
      return rows[0] ? mapCompany(rows[0]) : null;
    },
    getBySlug: async (slug: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_companies WHERE slug = $1', [slug]);
      return rows[0] ? mapCompany(rows[0]) : null;
    },
    list: async () => {
      const { rows } = await this.db.query('SELECT * FROM ai_companies ORDER BY name ASC');
      return rows.map(mapCompany);
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      if (!Object.keys(patch).length) return this.companies.get(id);
      const { sets, values, next } = setClause(patch);
      const { rows } = await this.db.query(
        `UPDATE ai_companies SET ${sets} WHERE id = $${next} RETURNING *`,
        [...values, id],
      );
      return rows[0] ? mapCompany(rows[0]) : null;
    },
  };

  tasks = {
    create: async (t: NewTask): Promise<Task> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_tasks (title, task_type, status, priority, company_id, project_id,
           created_by, assigned_to, borrower_reference, loan_reference, due_at, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          t.title, t.task_type, t.status, t.priority, t.company_id, t.project_id,
          t.created_by, t.assigned_to, t.borrower_reference, t.loan_reference, t.due_at,
          JSON.stringify(t.metadata_json),
        ],
      );
      return mapTask(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_tasks WHERE id = $1', [id]);
      return rows[0] ? mapTask(rows[0]) : null;
    },
    update: async (id: string, patch: Partial<NewTask>) => {
      if (!Object.keys(patch).length) return this.tasks.get(id);
      const { sets, values, next } = setClause(patch as Record<string, unknown>);
      const { rows } = await this.db.query(
        `UPDATE ai_tasks SET ${sets} WHERE id = $${next} RETURNING *`,
        [...values, id],
      );
      return rows[0] ? mapTask(rows[0]) : null;
    },
    list: async (filter: TaskFilter): Promise<Paginated<Task>> => {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (cond: string, value: unknown) => {
        params.push(value);
        where.push(cond.replace('?', `$${params.length}`));
      };
      if (filter.company_id) add('company_id = ?', filter.company_id);
      if (filter.project_id) add('project_id = ?', filter.project_id);
      if (filter.status) add('status = ?', filter.status);
      if (filter.task_type) add('task_type = ?', filter.task_type);
      if (filter.priority) add('priority = ?', filter.priority);
      if (filter.assigned_to) add('assigned_to = ?', filter.assigned_to);
      if (filter.search)
        add(
          '(title ILIKE ? OR borrower_reference ILIKE $' + (params.length + 1) +
            ' OR loan_reference ILIKE $' + (params.length + 1) + ')',
          `%${filter.search}%`,
        );
      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const count = await this.db.query(`SELECT count(*)::int AS n FROM ai_tasks${whereSql}`, params);
      const { rows } = await this.db.query(
        `SELECT * FROM ai_tasks${whereSql} ORDER BY created_at DESC${limitOffset(filter)}`,
        params,
      );
      return { items: rows.map(mapTask), page: filter.page, pageSize: filter.pageSize, total: count.rows[0].n };
    },
  };

  taskInputs = {
    create: async (i: NewTaskInput): Promise<TaskInput> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_task_inputs (task_id, input_type, content, source_document_id)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [i.task_id, i.input_type, i.content, i.source_document_id],
      );
      return mapInput(rows[0]);
    },
    listByTask: async (taskId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_task_inputs WHERE task_id = $1 ORDER BY created_at ASC',
        [taskId],
      );
      return rows.map(mapInput);
    },
  };

  runs = {
    create: async (r: NewTaskRun): Promise<TaskRun> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_task_runs (task_id, workflow_name, langgraph_run_id, model_provider,
           model_name, prompt_version, status, requested_by, started_at, completed_at,
           error_message, token_input_count, token_output_count, estimated_cost, input_snapshot_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          r.task_id, r.workflow_name, r.langgraph_run_id, r.model_provider,
          r.model_name, r.prompt_version, r.status, r.requested_by, r.started_at,
          r.completed_at, r.error_message, r.token_input_count, r.token_output_count,
          r.estimated_cost, JSON.stringify(r.input_snapshot_json),
        ],
      );
      return mapRun(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_task_runs WHERE id = $1', [id]);
      return rows[0] ? mapRun(rows[0]) : null;
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      if (!Object.keys(patch).length) return this.runs.get(id);
      const { sets, values, next } = setClause(patch);
      const { rows } = await this.db.query(
        `UPDATE ai_task_runs SET ${sets} WHERE id = $${next} RETURNING *`,
        [...values, id],
      );
      return rows[0] ? mapRun(rows[0]) : null;
    },
    listByTask: async (taskId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_task_runs WHERE task_id = $1 ORDER BY created_at DESC',
        [taskId],
      );
      return rows.map(mapRun);
    },
    usageSummary: async (sinceIso: string, companyId?: string): Promise<UsageSummary> => {
      const params: unknown[] = [sinceIso];
      let companySql = '';
      if (companyId) {
        params.push(companyId);
        companySql = ' AND t.company_id = $2';
      }
      const base = `FROM ai_task_runs r JOIN ai_tasks t ON t.id = r.task_id
          WHERE r.created_at >= $1${companySql}`;
      const totals = await this.db.query(
        `SELECT count(*)::int AS runs,
                COALESCE(SUM(r.token_input_count), 0)::int AS tokens_in,
                COALESCE(SUM(r.token_output_count), 0)::int AS tokens_out,
                COALESCE(SUM(r.estimated_cost), 0)::text AS estimated_cost
           ${base}`,
        params,
      );
      const byWorkflow = await this.db.query(
        `SELECT r.workflow_name, count(*)::int AS runs,
                COALESCE(SUM(r.token_input_count), 0)::int AS tokens_in,
                COALESCE(SUM(r.token_output_count), 0)::int AS tokens_out,
                COALESCE(SUM(r.estimated_cost), 0)::text AS estimated_cost
           ${base}
          GROUP BY r.workflow_name
          ORDER BY SUM(r.estimated_cost) DESC NULLS LAST, count(*) DESC`,
        params,
      );
      const byDay = await this.db.query(
        `SELECT to_char(date_trunc('day', r.created_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS runs,
                COALESCE(SUM(r.estimated_cost), 0)::text AS estimated_cost
           ${base}
          GROUP BY 1 ORDER BY 1 ASC`,
        params,
      );
      return {
        since: sinceIso,
        totals: totals.rows[0],
        by_workflow: byWorkflow.rows,
        by_day: byDay.rows,
      };
    },
  };

  outputs = {
    create: async (o: NewAiOutput): Promise<AiOutput> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_outputs (task_run_id, output_type, content, structured_json,
           confidence_label, requires_human_review, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          o.task_run_id, o.output_type, o.content,
          o.structured_json ? JSON.stringify(o.structured_json) : null,
          o.confidence_label, o.requires_human_review, o.review_status,
        ],
      );
      return mapOutput(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_outputs WHERE id = $1', [id]);
      return rows[0] ? mapOutput(rows[0]) : null;
    },
    setReviewStatus: async (id: string, status: AiOutput['review_status']) => {
      const { rows } = await this.db.query(
        'UPDATE ai_outputs SET review_status = $1 WHERE id = $2 RETURNING *',
        [status, id],
      );
      return rows[0] ? mapOutput(rows[0]) : null;
    },
    listByRun: async (runId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_outputs WHERE task_run_id = $1 ORDER BY created_at DESC',
        [runId],
      );
      return rows.map(mapOutput);
    },
    listByTask: async (taskId: string) => {
      const { rows } = await this.db.query(
        `SELECT o.* FROM ai_outputs o
           JOIN ai_task_runs r ON r.id = o.task_run_id
         WHERE r.task_id = $1 ORDER BY o.created_at DESC`,
        [taskId],
      );
      return rows.map(mapOutput);
    },
    list: async (filter: OutputFilter): Promise<Paginated<OutputListItem>> => {
      const params: unknown[] = [];
      let whereSql = '';
      if (filter.review_status) {
        params.push(filter.review_status);
        whereSql = ' WHERE o.review_status = $1';
      }
      const base = `FROM ai_outputs o
          JOIN ai_task_runs r ON r.id = o.task_run_id
          JOIN ai_tasks t ON t.id = r.task_id${whereSql}`;
      const count = await this.db.query(`SELECT count(*)::int AS n ${base}`, params);
      const { rows } = await this.db.query(
        `SELECT o.*, r.task_id, t.title AS task_title, r.workflow_name ${base}
         ORDER BY o.created_at DESC${limitOffset(filter)}`,
        params,
      );
      return {
        items: rows.map((r) => mapOutput(r) as OutputListItem),
        page: filter.page,
        pageSize: filter.pageSize,
        total: count.rows[0].n,
      };
    },
  };

  approvals = {
    create: async (a: NewApproval): Promise<Approval> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_approvals (task_id, output_id, reviewed_by, decision,
           reviewer_notes, edited_final_content)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [a.task_id, a.output_id, a.reviewed_by, a.decision, a.reviewer_notes, a.edited_final_content],
      );
      return mapApproval(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_approvals WHERE id = $1', [id]);
      return rows[0] ? mapApproval(rows[0]) : null;
    },
    listByOutput: async (outputId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_approvals WHERE output_id = $1 ORDER BY reviewed_at DESC',
        [outputId],
      );
      return rows.map(mapApproval);
    },
    listByTask: async (taskId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_approvals WHERE task_id = $1 ORDER BY reviewed_at DESC',
        [taskId],
      );
      return rows.map(mapApproval);
    },
    listDecisionsSince: async (sinceIso: string, companyId?: string) => {
      const params: unknown[] = [sinceIso];
      let companySql = '';
      if (companyId) {
        params.push(companyId);
        companySql = ' AND t.company_id = $2';
      }
      const { rows } = await this.db.query(
        `SELECT a.decision, a.reviewed_at, a.edited_final_content,
                o.content AS output_content, r.workflow_name
           FROM ai_approvals a
           JOIN ai_outputs o ON o.id = a.output_id
           JOIN ai_task_runs r ON r.id = o.task_run_id
           JOIN ai_tasks t ON t.id = a.task_id
          WHERE a.reviewed_at >= $1${companySql}`,
        params,
      );
      return rows.map((row) => ({
        decision: row.decision,
        reviewed_at: iso(row.reviewed_at)!,
        edited_final_content: row.edited_final_content,
        output_content: row.output_content,
        workflow_name: row.workflow_name,
      }));
    },
  };

  audit = {
    append: async (e: NewAuditEvent): Promise<AuditEvent> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_audit_events (task_id, company_id, actor_user_id, event_type, event_payload_json)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [e.task_id, e.company_id, e.actor_user_id, e.event_type, JSON.stringify(e.event_payload_json)],
      );
      return mapAudit(rows[0]);
    },
    list: async (filter: AuditFilter): Promise<Paginated<AuditEvent>> => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.company_id) {
        params.push(filter.company_id);
        where.push(`company_id = $${params.length}`);
      }
      if (filter.event_type) {
        params.push(filter.event_type);
        where.push(`event_type = $${params.length}`);
      }
      if (filter.actor) {
        params.push(filter.actor);
        where.push(`actor_user_id = $${params.length}`);
      }
      if (filter.task_id) {
        params.push(filter.task_id);
        where.push(`task_id = $${params.length}`);
      }
      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const count = await this.db.query(
        `SELECT count(*)::int AS n FROM ai_audit_events${whereSql}`,
        params,
      );
      const { rows } = await this.db.query(
        `SELECT * FROM ai_audit_events${whereSql} ORDER BY id DESC${limitOffset(filter)}`,
        params,
      );
      return { items: rows.map(mapAudit), page: filter.page, pageSize: filter.pageSize, total: count.rows[0].n };
    },
    listByTask: async (taskId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_audit_events WHERE task_id = $1 ORDER BY id DESC',
        [taskId],
      );
      return rows.map(mapAudit);
    },
  };

  documents = {
    create: async (d: NewSourceDocument): Promise<SourceDocument> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_source_documents (filename, file_type, s3_bucket, s3_key,
           text_extraction_status, document_type, classification, company_id, created_by, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          d.filename, d.file_type, d.s3_bucket, d.s3_key, d.text_extraction_status,
          d.document_type, d.classification, d.company_id, d.created_by, JSON.stringify(d.metadata_json),
        ],
      );
      return mapDocument(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_source_documents WHERE id = $1', [id]);
      return rows[0] ? mapDocument(rows[0]) : null;
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      if (!Object.keys(patch).length) return this.documents.get(id);
      const { sets, values, next } = setClause(patch);
      const { rows } = await this.db.query(
        `UPDATE ai_source_documents SET ${sets} WHERE id = $${next} RETURNING *`,
        [...values, id],
      );
      return rows[0] ? mapDocument(rows[0]) : null;
    },
    list: async (filter: Page & { document_type?: string; company_id?: string }) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (filter.document_type) {
        params.push(filter.document_type);
        where.push(`document_type = $${params.length}`);
      }
      if (filter.company_id) {
        params.push(filter.company_id);
        where.push(`company_id = $${params.length}`);
      }
      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const count = await this.db.query(
        `SELECT count(*)::int AS n FROM ai_source_documents${whereSql}`,
        params,
      );
      const { rows } = await this.db.query(
        `SELECT * FROM ai_source_documents${whereSql} ORDER BY created_at DESC${limitOffset(filter)}`,
        params,
      );
      return { items: rows.map(mapDocument), page: filter.page, pageSize: filter.pageSize, total: count.rows[0].n };
    },
  };

  chunks = {
    create: async (c: NewSourceChunk): Promise<SourceChunk> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_source_chunks (document_id, chunk_index, content, page_number,
           section_label, embedding_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [c.document_id, c.chunk_index, c.content, c.page_number, c.section_label, c.embedding_id],
      );
      return mapChunk(rows[0]);
    },
    listByDocument: async (documentId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_source_chunks WHERE document_id = $1 ORDER BY chunk_index ASC',
        [documentId],
      );
      return rows.map(mapChunk);
    },
    getMany: async (ids: string[]) => {
      if (!ids.length) return [];
      const { rows } = await this.db.query(
        'SELECT * FROM ai_source_chunks WHERE id = ANY($1::uuid[])',
        [ids],
      );
      return rows.map(mapChunk);
    },
    nextIndex: async (documentId: string) => {
      const { rows } = await this.db.query(
        'SELECT COALESCE(MAX(chunk_index) + 1, 0)::int AS next FROM ai_source_chunks WHERE document_id = $1',
        [documentId],
      );
      return rows[0].next as number;
    },
    setEmbedding: async (chunkId: string, model: string, embedding: number[]) => {
      await this.db.query(
        'UPDATE ai_source_chunks SET embedding_json = $1, embedding_model = $2 WHERE id = $3',
        [JSON.stringify(embedding), model, chunkId],
      );
    },
    listEmbedded: async (model: string, companyId?: string): Promise<EmbeddedChunk[]> => {
      const params: unknown[] = [model];
      let companySql = '';
      if (companyId) {
        params.push(companyId);
        companySql = ' AND d.company_id = $2';
      }
      const { rows } = await this.db.query(
        `SELECT c.id, c.document_id, c.content, c.section_label, c.page_number, c.embedding_json
           FROM ai_source_chunks c
           JOIN ai_source_documents d ON d.id = c.document_id
          WHERE c.embedding_model = $1 AND c.embedding_json IS NOT NULL${companySql}`,
        params,
      );
      return rows.map((r) => ({
        chunk_id: r.id,
        document_id: r.document_id,
        content: r.content,
        section_label: r.section_label,
        page_number: r.page_number,
        embedding: r.embedding_json as number[],
      }));
    },
  };

  citations = {
    createMany: async (rowsIn: NewCitation[]): Promise<Citation[]> => {
      const out: Citation[] = [];
      for (const c of rowsIn) {
        const { rows } = await this.db.query(
          `INSERT INTO ai_citations (output_id, document_id, chunk_id, citation_text,
             source_label, page_number)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [c.output_id, c.document_id, c.chunk_id, c.citation_text, c.source_label, c.page_number],
        );
        out.push(mapCitation(rows[0]));
      }
      return out;
    },
    listByOutput: async (outputId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_citations WHERE output_id = $1 ORDER BY created_at ASC',
        [outputId],
      );
      return rows.map(mapCitation);
    },
  };

  prompts = {
    create: async (p: NewPromptTemplate): Promise<PromptTemplate> =>
      this.withTransaction(async (s) => {
        const tx = s as PgStore;
        if (p.is_active) {
          await tx.db.query('UPDATE ai_prompt_templates SET is_active = false WHERE name = $1', [p.name]);
        }
        const { rows } = await tx.db.query(
          `INSERT INTO ai_prompt_templates (name, version, task_type, system_prompt,
             user_prompt_template, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [p.name, p.version, p.task_type, p.system_prompt, p.user_prompt_template, p.is_active, p.created_by],
        );
        return mapPrompt(rows[0]);
      }),
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_prompt_templates WHERE id = $1', [id]);
      return rows[0] ? mapPrompt(rows[0]) : null;
    },
    list: async (filter: { name?: string; task_type?: string }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.name) {
        params.push(filter.name);
        where.push(`name = $${params.length}`);
      }
      if (filter.task_type) {
        params.push(filter.task_type);
        where.push(`task_type = $${params.length}`);
      }
      const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const { rows } = await this.db.query(
        `SELECT * FROM ai_prompt_templates${whereSql} ORDER BY name ASC, version DESC`,
        params,
      );
      return rows.map(mapPrompt);
    },
    getActiveByName: async (name: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_prompt_templates WHERE name = $1 AND is_active LIMIT 1',
        [name],
      );
      return rows[0] ? mapPrompt(rows[0]) : null;
    },
    maxVersion: async (name: string) => {
      const { rows } = await this.db.query(
        'SELECT COALESCE(MAX(version), 0)::int AS v FROM ai_prompt_templates WHERE name = $1',
        [name],
      );
      return rows[0].v as number;
    },
    setActive: async (id: string, active: boolean) =>
      this.withTransaction(async (s) => {
        const tx = s as PgStore;
        const existing = await tx.db.query('SELECT * FROM ai_prompt_templates WHERE id = $1', [id]);
        if (!existing.rows[0]) return null;
        if (active) {
          await tx.db.query(
            'UPDATE ai_prompt_templates SET is_active = false WHERE name = $1 AND id <> $2',
            [existing.rows[0].name, id],
          );
        }
        const { rows } = await tx.db.query(
          'UPDATE ai_prompt_templates SET is_active = $1 WHERE id = $2 RETURNING *',
          [active, id],
        );
        return mapPrompt(rows[0]);
      }),
  };

  workflowConfigs = {
    upsert: async (c: NewWorkflowConfig): Promise<WorkflowConfig> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_workflow_configs (workflow_name, task_type, requires_approval,
           allowed_tools_json, model_config_json, is_active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (workflow_name) DO UPDATE SET
           task_type = EXCLUDED.task_type,
           requires_approval = EXCLUDED.requires_approval,
           allowed_tools_json = EXCLUDED.allowed_tools_json,
           model_config_json = EXCLUDED.model_config_json,
           is_active = EXCLUDED.is_active
         RETURNING *`,
        [
          c.workflow_name, c.task_type, c.requires_approval,
          JSON.stringify(c.allowed_tools_json), JSON.stringify(c.model_config_json), c.is_active,
        ],
      );
      return mapConfig(rows[0]);
    },
    getByName: async (workflowName: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_workflow_configs WHERE workflow_name = $1',
        [workflowName],
      );
      return rows[0] ? mapConfig(rows[0]) : null;
    },
    list: async () => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_workflow_configs ORDER BY workflow_name ASC',
      );
      return rows.map(mapConfig);
    },
  };

  actions = {
    create: async (a: NewIntegrationAction): Promise<IntegrationAction> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_integration_actions (task_id, approval_id, action_type,
           target_system, status, request_payload_json)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          a.task_id, a.approval_id, a.action_type, a.target_system, a.status,
          JSON.stringify(a.request_payload_json),
        ],
      );
      return mapAction(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_integration_actions WHERE id = $1',
        [id],
      );
      return rows[0] ? mapAction(rows[0]) : null;
    },
    /** Row-locked read; serializes concurrent executes inside withTransaction. */
    getForUpdate: async (id: string) => {
      const { rows } = await this.db.query(
        `SELECT * FROM ai_integration_actions WHERE id = $1${this.inTx ? ' FOR UPDATE' : ''}`,
        [id],
      );
      return rows[0] ? mapAction(rows[0]) : null;
    },
    update: async (id: string, patch: Record<string, unknown>) => {
      if (!Object.keys(patch).length) return this.actions.get(id);
      const { sets, values, next } = setClause(patch);
      const { rows } = await this.db.query(
        `UPDATE ai_integration_actions SET ${sets} WHERE id = $${next} RETURNING *`,
        [...values, id],
      );
      return rows[0] ? mapAction(rows[0]) : null;
    },
    list: async (filter: ActionFilter) => {
      const params: unknown[] = [];
      let whereSql = '';
      if (filter.status) {
        params.push(filter.status);
        whereSql = ' WHERE status = $1';
      }
      const count = await this.db.query(
        `SELECT count(*)::int AS n FROM ai_integration_actions${whereSql}`,
        params,
      );
      const { rows } = await this.db.query(
        `SELECT * FROM ai_integration_actions${whereSql} ORDER BY created_at DESC${limitOffset(filter)}`,
        params,
      );
      return { items: rows.map(mapAction), page: filter.page, pageSize: filter.pageSize, total: count.rows[0].n };
    },
    listByTask: async (taskId: string) => {
      const { rows } = await this.db.query(
        'SELECT * FROM ai_integration_actions WHERE task_id = $1 ORDER BY created_at DESC',
        [taskId],
      );
      return rows.map(mapAction);
    },
  };

  async ping(): Promise<'up' | 'down' | 'skipped'> {
    try {
      await this.db.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
