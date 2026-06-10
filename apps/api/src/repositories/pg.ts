import type { Pool, PoolClient } from 'pg';
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
  ActionFilter,
  AuditFilter,
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
} from './interfaces';

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

/* Row mappers: convert pg Date objects to ISO strings; jsonb arrives parsed. */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
const mapChunk = (r: any): SourceChunk => ({ ...r, created_at: iso(r.created_at)! });
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

  tasks = {
    create: async (t: NewTask): Promise<Task> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_tasks (title, task_type, status, priority, created_by,
           assigned_to, borrower_reference, loan_reference, due_at, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          t.title, t.task_type, t.status, t.priority, t.created_by,
          t.assigned_to, t.borrower_reference, t.loan_reference, t.due_at,
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
  };

  audit = {
    append: async (e: NewAuditEvent): Promise<AuditEvent> => {
      const { rows } = await this.db.query(
        `INSERT INTO ai_audit_events (task_id, actor_user_id, event_type, event_payload_json)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [e.task_id, e.actor_user_id, e.event_type, JSON.stringify(e.event_payload_json)],
      );
      return mapAudit(rows[0]);
    },
    list: async (filter: AuditFilter): Promise<Paginated<AuditEvent>> => {
      const where: string[] = [];
      const params: unknown[] = [];
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
           text_extraction_status, document_type, classification, created_by, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          d.filename, d.file_type, d.s3_bucket, d.s3_key, d.text_extraction_status,
          d.document_type, d.classification, d.created_by, JSON.stringify(d.metadata_json),
        ],
      );
      return mapDocument(rows[0]);
    },
    get: async (id: string) => {
      const { rows } = await this.db.query('SELECT * FROM ai_source_documents WHERE id = $1', [id]);
      return rows[0] ? mapDocument(rows[0]) : null;
    },
    list: async (filter: Page & { document_type?: string }) => {
      const params: unknown[] = [];
      let whereSql = '';
      if (filter.document_type) {
        params.push(filter.document_type);
        whereSql = ' WHERE document_type = $1';
      }
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
