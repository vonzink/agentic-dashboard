import { ApiError } from '../middleware/error';
import type { AppConfig } from '../config';
import type { Store } from '../repositories/interfaces';
import type { AiOutput, AuthUser, TaskRun } from '../types/domain';
import type { ModelProvider } from '../workflows/providers';
import { WORKFLOWS } from '../workflows/registry';
import { renderPrompt, runWorkflow, WorkflowOutputError } from '../workflows/runner';
import type { SourceSnippet, WorkflowInput } from '../workflows/types';
import type { AuditService } from './audit';
import type { PromptService } from './prompts';
import type { TaskService } from './tasks';

export interface RunOptions {
  tone?: string;
  loan_type?: string;
  lender?: string;
  employment_type?: string;
  property_type?: string;
  occupancy?: string;
  special_scenario?: string;
  source_chunk_ids?: string[];
}

export class RunService {
  constructor(
    private store: Store,
    private audit: AuditService,
    private tasks: TaskService,
    private prompts: PromptService,
    private provider: ModelProvider,
    private config: AppConfig,
  ) {}

  /**
   * Executes a workflow for a task, synchronously (MVP). Persists the run
   * (full provenance), the output (NEEDS_REVIEW), and citations; writes
   * audit events for every transition. Failures are persisted too — a
   * failed run is part of the record, not an exception that vanishes.
   */
  async run(actor: AuthUser, taskId: string, workflowName: string, options: RunOptions = {}) {
    const task = await this.tasks.get(taskId);
    if (task.status === 'archived' || task.status === 'cancelled') {
      throw ApiError.conflict('TASK_CLOSED', `Cannot run workflows on a ${task.status} task`);
    }

    const def = WORKFLOWS[workflowName];
    if (!def) throw ApiError.badRequest(`Unknown or unimplemented workflow '${workflowName}'`);
    const wfConfig = await this.store.workflowConfigs.getByName(workflowName);
    if (wfConfig && !wfConfig.is_active) {
      throw ApiError.conflict('WORKFLOW_DISABLED', `Workflow '${workflowName}' is disabled`);
    }

    const input = await this.assembleInput(taskId, task.title, def.taskType, options);
    const promptTemplate = await this.prompts.activeFor(def.name);
    const prompt = renderPrompt(promptTemplate, input);

    const run = await this.store.runs.create({
      task_id: taskId,
      workflow_name: def.name,
      langgraph_run_id: null,
      model_provider: this.provider.name,
      model_name: this.provider.model,
      prompt_version: prompt.version,
      status: 'running',
      requested_by: actor.email,
      started_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
      token_input_count: null,
      token_output_count: null,
      estimated_cost: null,
      // Exact context the model saw — sources included — for later audit.
      input_snapshot_json: { input, options, prompt_version: prompt.version },
    });
    await this.audit.record('run.requested', {
      taskId,
      actor: actor.email,
      payload: {
        run_id: run.id,
        workflow: def.name,
        prompt_version: prompt.version,
        provider: this.provider.name,
        model: this.provider.model,
        source_count: input.sources.length,
      },
    });

    try {
      const result = await runWorkflow(def, this.provider, prompt, input);

      const cost =
        this.provider.name === 'mock'
          ? '0'
          : (
              (result.tokens.input * this.config.costPerMTokIn +
                result.tokens.output * this.config.costPerMTokOut) /
              1_000_000
            ).toFixed(6);

      const completedRun = await this.store.runs.update(run.id, {
        status: 'succeeded',
        completed_at: new Date().toISOString(),
        langgraph_run_id: result.langgraphRunId,
        token_input_count: result.tokens.input,
        token_output_count: result.tokens.output,
        estimated_cost: cost,
      });

      const requiresApproval = wfConfig?.requires_approval ?? true;
      const output = await this.store.outputs.create({
        task_run_id: run.id,
        output_type: def.outputType,
        content: result.mainContent,
        structured_json: result.structured,
        confidence_label: result.confidence,
        requires_human_review: true, // invariant in MVP, regardless of config
        review_status: requiresApproval ? 'NEEDS_REVIEW' : 'AI_GENERATED',
      });

      const citations = await this.store.citations.createMany(
        result.citations.map((c) => {
          const matched = input.sources.find((s) => s.source_label === c.source_label);
          return {
            output_id: output.id,
            document_id: matched?.document_id ?? null,
            chunk_id: matched?.chunk_id ?? null,
            citation_text: c.citation_text,
            source_label: c.source_label,
            page_number: c.page_number ?? null,
          };
        }),
      );

      await this.audit.record('run.completed', {
        taskId,
        actor: actor.email,
        payload: {
          run_id: run.id,
          output_id: output.id,
          confidence: result.confidence,
          warnings: result.warnings,
          citation_count: citations.length,
          tokens: result.tokens,
          estimated_cost: cost,
        },
      });
      await this.audit.record('output.created', {
        taskId,
        actor: actor.email,
        payload: { output_id: output.id, review_status: output.review_status },
      });

      if (task.status === 'open' || task.status === 'in_progress') {
        await this.store.tasks.update(taskId, { status: 'waiting_review' });
      }

      return { run: completedRun!, outputs: [{ ...output, citations }] };
    } catch (err) {
      const message =
        err instanceof WorkflowOutputError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown workflow error';
      await this.store.runs.update(run.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: message,
      });
      await this.audit.record('run.failed', {
        taskId,
        actor: actor.email,
        payload: { run_id: run.id, error: message },
      });
      throw new ApiError(502, 'WORKFLOW_FAILED', `Workflow run failed: ${message}`);
    }
  }

  /** Builds the WorkflowInput from task inputs + selected source chunks. */
  private async assembleInput(
    taskId: string,
    taskTitle: string,
    taskType: WorkflowInput['task_type'],
    options: RunOptions,
  ): Promise<WorkflowInput> {
    const inputs = await this.store.taskInputs.listByTask(taskId);

    const textOf = (...types: string[]) =>
      inputs
        .filter((i) => types.includes(i.input_type))
        .map((i) => i.content)
        .join('\n\n') || null;

    const sources: SourceSnippet[] = [];
    // Manual snippets typed directly onto the task.
    for (const i of inputs.filter((i) => i.input_type === 'source_snippet')) {
      sources.push({
        document_id: i.source_document_id,
        chunk_id: null,
        source_label: i.source_document_id ? `Document ${i.source_document_id.slice(0, 8)}` : 'Task snippet',
        content: i.content,
        page_number: null,
      });
    }
    // Referenced documents: include their chunks.
    for (const i of inputs.filter(
      (i) => i.input_type === 'document_reference' && i.source_document_id,
    )) {
      const doc = await this.store.documents.get(i.source_document_id!);
      if (!doc) continue;
      const chunks = await this.store.chunks.listByDocument(doc.id);
      for (const c of chunks.slice(0, 10)) {
        sources.push({
          document_id: doc.id,
          chunk_id: c.id,
          source_label: c.section_label ? `${doc.filename} — ${c.section_label}` : doc.filename,
          content: c.content,
          page_number: c.page_number,
        });
      }
    }
    // Explicitly selected chunks for this run.
    if (options.source_chunk_ids?.length) {
      const chunks = await this.store.chunks.getMany(options.source_chunk_ids);
      for (const c of chunks) {
        if (sources.some((s) => s.chunk_id === c.id)) continue;
        const doc = await this.store.documents.get(c.document_id);
        sources.push({
          document_id: c.document_id,
          chunk_id: c.id,
          source_label: c.section_label
            ? `${doc?.filename ?? 'Document'} — ${c.section_label}`
            : (doc?.filename ?? 'Document'),
          content: c.content,
          page_number: c.page_number,
        });
      }
    }

    return {
      task_title: taskTitle,
      task_type: taskType,
      primary_text:
        textOf('condition_text', 'question') ?? textOf('other', 'instruction') ?? taskTitle,
      borrower_context: textOf('borrower_context'),
      scenario: textOf('scenario'),
      instructions: textOf('instruction'),
      sources,
      options: {
        tone: options.tone,
        loan_type: options.loan_type,
        lender: options.lender,
        employment_type: options.employment_type,
        property_type: options.property_type,
        occupancy: options.occupancy,
        special_scenario: options.special_scenario,
      },
    };
  }

  async get(runId: string): Promise<TaskRun & { outputs: AiOutput[] }> {
    const run = await this.store.runs.get(runId);
    if (!run) throw ApiError.notFound('Run');
    const outputs = await this.store.outputs.listByRun(runId);
    return { ...run, outputs };
  }

  async listByTask(taskId: string): Promise<TaskRun[]> {
    await this.tasks.get(taskId);
    return this.store.runs.listByTask(taskId);
  }
}
