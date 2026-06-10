import { ApiError } from '../middleware/error';
import type { Store } from '../repositories/interfaces';
import type { AuthUser, PromptTemplate } from '../types/domain';
import type { TaskType } from '../types/statuses';
import type { AuditService } from './audit';

export class PromptService {
  constructor(
    private store: Store,
    private audit: AuditService,
  ) {}

  list(filter: { name?: string; task_type?: string }) {
    return this.store.prompts.list(filter);
  }

  /** Creates the next version of a named prompt (versions are immutable). */
  async createVersion(
    actor: AuthUser,
    body: {
      name: string;
      task_type: TaskType;
      system_prompt: string;
      user_prompt_template: string;
      activate: boolean;
    },
  ): Promise<PromptTemplate> {
    const version = (await this.store.prompts.maxVersion(body.name)) + 1;
    const prompt = await this.store.prompts.create({
      name: body.name,
      version,
      task_type: body.task_type,
      system_prompt: body.system_prompt,
      user_prompt_template: body.user_prompt_template,
      is_active: body.activate,
      created_by: actor.email,
    });
    await this.audit.record('prompt.created', {
      actor: actor.email,
      payload: { name: prompt.name, version: prompt.version, activated: body.activate },
    });
    return prompt;
  }

  async setActive(actor: AuthUser, id: string, active: boolean): Promise<PromptTemplate> {
    const updated = await this.store.prompts.setActive(id, active);
    if (!updated) throw ApiError.notFound('Prompt template');
    await this.audit.record('prompt.activation_changed', {
      actor: actor.email,
      payload: { name: updated.name, version: updated.version, is_active: active },
    });
    return updated;
  }

  /** Active template for a workflow; falls back to nothing — callers fail loudly. */
  async activeFor(name: string): Promise<PromptTemplate> {
    const prompt = await this.store.prompts.getActiveByName(name);
    if (!prompt) {
      throw ApiError.conflict(
        'NO_ACTIVE_PROMPT',
        `No active prompt template named '${name}'. Run db:seed or activate one in Admin.`,
      );
    }
    return prompt;
  }
}
