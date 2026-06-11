import type { Store } from '../repositories/interfaces';
import { DEFAULT_PROMPTS } from '../workflows/prompts';
import { PLANNED_WORKFLOWS, WORKFLOWS } from '../workflows/registry';

/**
 * Idempotently seeds workflow configs and v1 prompt templates.
 * Single source of truth for both Postgres (`npm run db:seed`) and the
 * in-memory store (seeded automatically at app start). Contains no
 * borrower data — synthetic/system rows only.
 */
export async function seedDefaults(store: Store): Promise<void> {
  // First client company; additional companies are created in Admin.
  if (!(await store.companies.getBySlug('msfg'))) {
    await store.companies.create({
      name: 'Mountain State Financial Group',
      slug: 'msfg',
      is_active: true,
      monthly_budget: null,
    });
  }
  for (const def of Object.values(WORKFLOWS)) {
    const existing = await store.workflowConfigs.getByName(def.name);
    if (!existing) {
      await store.workflowConfigs.upsert({
        workflow_name: def.name,
        task_type: def.taskType,
        requires_approval: true,
        allowed_tools_json: [],
        model_config_json: {},
        is_active: true,
      });
    }
  }
  for (const planned of PLANNED_WORKFLOWS) {
    const existing = await store.workflowConfigs.getByName(planned.workflow_name);
    if (!existing) {
      await store.workflowConfigs.upsert({
        workflow_name: planned.workflow_name,
        task_type: planned.task_type,
        requires_approval: true,
        allowed_tools_json: [],
        model_config_json: {},
        is_active: false,
      });
    }
  }
  for (const prompt of DEFAULT_PROMPTS) {
    const existing = await store.prompts.maxVersion(prompt.name);
    if (existing === 0) {
      await store.prompts.create({
        name: prompt.name,
        version: 1,
        task_type: prompt.task_type,
        system_prompt: prompt.system_prompt,
        user_prompt_template: prompt.user_prompt_template,
        is_active: true,
        created_by: 'system@msfg.local',
      });
    }
  }
}
