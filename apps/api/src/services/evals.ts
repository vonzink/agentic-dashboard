import { ApiError } from '../middleware/error';
import type { Store } from '../repositories/interfaces';
import type { AuthUser, EvalCase, EvalCaseResult, EvalRun } from '../types/domain';
import type { ConfidenceLabel } from '../types/statuses';
import type { ProviderRegistry } from '../workflows/providers';
import { WORKFLOWS } from '../workflows/registry';
import { renderPrompt, runWorkflow } from '../workflows/runner';
import type { WorkflowInput } from '../workflows/types';
import type { AuditService } from './audit';
import type { PromptService } from './prompts';

/**
 * Eval sets: saved test inputs per workflow, run against a prompt version
 * BEFORE activating it — change prompts with evidence instead of hope.
 *
 * Eval runs are sandboxed by construction: they create no tasks, no
 * outputs, and nothing for the review queue. They use the same LangGraph +
 * schema validation as production runs, so a prompt that breaks JSON
 * output fails its evals the same way it would fail a real run.
 */

const CONFIDENCE_RANK: Record<ConfidenceLabel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export class EvalService {
  constructor(
    private store: Store,
    private audit: AuditService,
    private prompts: PromptService,
    private providers: ProviderRegistry,
  ) {}

  async createCase(
    actor: AuthUser,
    body: {
      workflow_name: string;
      name: string;
      primary_text: string;
      source_text?: string | null;
      contains?: string[];
      min_confidence?: ConfidenceLabel;
    },
  ): Promise<EvalCase> {
    if (!WORKFLOWS[body.workflow_name]) {
      throw ApiError.badRequest(`Unknown workflow '${body.workflow_name}'`);
    }
    const row = await this.store.evalCases.create({
      workflow_name: body.workflow_name,
      name: body.name,
      input_json: { primary_text: body.primary_text, source_text: body.source_text ?? null },
      expectations_json: {
        ...(body.contains?.length && { contains: body.contains }),
        ...(body.min_confidence && { min_confidence: body.min_confidence }),
      },
      is_active: true,
      created_by: actor.email,
    });
    await this.audit.record('eval.case_created', {
      actor: actor.email,
      payload: { case_id: row.id, workflow: row.workflow_name, name: row.name },
    });
    return row;
  }

  listCases(workflowName?: string): Promise<EvalCase[]> {
    return this.store.evalCases.list(workflowName);
  }

  async setCaseActive(actor: AuthUser, id: string, active: boolean): Promise<EvalCase> {
    const updated = await this.store.evalCases.setActive(id, active);
    if (!updated) throw ApiError.notFound('Eval case');
    await this.audit.record('eval.case_updated', {
      actor: actor.email,
      payload: { case_id: id, is_active: active },
    });
    return updated;
  }

  listRuns(workflowName?: string): Promise<EvalRun[]> {
    return this.store.evalRuns.list(workflowName);
  }

  /**
   * Runs every active case for a workflow against a prompt version
   * (`promptId` for a draft version, or the active one) and records
   * pass/fail per expectation.
   */
  async run(actor: AuthUser, workflowName: string, promptId?: string): Promise<EvalRun> {
    const def = WORKFLOWS[workflowName];
    if (!def) throw ApiError.badRequest(`Unknown workflow '${workflowName}'`);

    const template = promptId
      ? await this.store.prompts.get(promptId)
      : await this.prompts.activeFor(workflowName);
    if (!template) throw ApiError.notFound('Prompt template');
    if (template.name !== workflowName) {
      throw ApiError.badRequest(
        `Prompt '${template.name}' does not belong to workflow '${workflowName}'`,
      );
    }

    const cases = (await this.store.evalCases.list(workflowName)).filter((c) => c.is_active);
    if (!cases.length) {
      throw ApiError.conflict('NO_EVAL_CASES', `No active eval cases for '${workflowName}'`);
    }

    const wfConfig = await this.store.workflowConfigs.getByName(workflowName);
    const provider = this.providers.resolve(wfConfig?.model_config_json);

    const results: EvalCaseResult[] = [];
    for (const c of cases) {
      results.push(await this.runCase(def.name, c, template, provider));
    }

    const passed = results.filter((r) => r.passed).length;
    const evalRun = await this.store.evalRuns.create({
      workflow_name: workflowName,
      prompt_version: `${template.name}@${template.version}`,
      model_provider: provider.name,
      model_name: provider.model,
      passed_count: passed,
      failed_count: results.length - passed,
      results_json: results,
      created_by: actor.email,
    });
    await this.audit.record('eval.completed', {
      actor: actor.email,
      payload: {
        eval_run_id: evalRun.id,
        workflow: workflowName,
        prompt_version: evalRun.prompt_version,
        passed: passed,
        failed: results.length - passed,
      },
    });
    return evalRun;
  }

  private async runCase(
    workflowName: string,
    c: EvalCase,
    template: { name: string; version: number; system_prompt: string; user_prompt_template: string },
    provider: ReturnType<ProviderRegistry['resolve']>,
  ): Promise<EvalCaseResult> {
    const def = WORKFLOWS[workflowName]!;
    const input: WorkflowInput = {
      company_name: 'Eval Harness',
      task_title: c.name,
      task_type: def.taskType,
      primary_text: c.input_json.primary_text,
      borrower_context: null,
      scenario: null,
      instructions: null,
      sources: c.input_json.source_text
        ? [
            {
              document_id: null,
              chunk_id: null,
              source_label: 'Eval source',
              content: c.input_json.source_text,
              page_number: null,
            },
          ]
        : [],
      options: {},
    };

    try {
      const prompt = renderPrompt(template, input);
      const result = await runWorkflow(def, provider, prompt, input);
      const failures: string[] = [];
      const haystack = result.mainContent.toLowerCase();
      for (const needle of c.expectations_json.contains ?? []) {
        if (!haystack.includes(needle.toLowerCase())) {
          failures.push(`output does not contain "${needle}"`);
        }
      }
      const min = c.expectations_json.min_confidence;
      if (min && CONFIDENCE_RANK[result.confidence] < CONFIDENCE_RANK[min]) {
        failures.push(`confidence ${result.confidence} is below required ${min}`);
      }
      return {
        case_id: c.id,
        case_name: c.name,
        passed: failures.length === 0,
        failures,
        confidence: result.confidence,
        content_preview: result.mainContent.slice(0, 280),
      };
    } catch (err) {
      return {
        case_id: c.id,
        case_name: c.name,
        passed: false,
        failures: [`run failed: ${err instanceof Error ? err.message : String(err)}`],
        confidence: null,
        content_preview: '',
      };
    }
  }
}
