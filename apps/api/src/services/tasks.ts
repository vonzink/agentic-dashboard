import { ApiError } from '../middleware/error';
import type { Store, TaskFilter } from '../repositories/interfaces';
import type { AuthUser, Task, TaskInput } from '../types/domain';
import type { InputType } from '../types/statuses';
import type { AuditService } from './audit';

export class TaskService {
  constructor(
    private store: Store,
    private audit: AuditService,
  ) {}

  async create(
    actor: AuthUser,
    body: {
      title: string;
      task_type: Task['task_type'];
      priority: Task['priority'];
      assigned_to?: string | null;
      borrower_reference?: string | null;
      loan_reference?: string | null;
      due_at?: string | null;
      metadata_json: Record<string, unknown>;
    },
  ): Promise<Task> {
    const task = await this.store.tasks.create({
      title: body.title,
      task_type: body.task_type,
      status: 'open',
      priority: body.priority,
      created_by: actor.email,
      assigned_to: body.assigned_to ?? null,
      borrower_reference: body.borrower_reference ?? null,
      loan_reference: body.loan_reference ?? null,
      due_at: body.due_at ?? null,
      metadata_json: body.metadata_json,
    });
    await this.audit.record('task.created', {
      taskId: task.id,
      actor: actor.email,
      payload: { title: task.title, task_type: task.task_type, priority: task.priority },
    });
    return task;
  }

  async get(id: string): Promise<Task> {
    const task = await this.store.tasks.get(id);
    if (!task) throw ApiError.notFound('Task');
    return task;
  }

  async detail(id: string) {
    const task = await this.get(id);
    const [inputs, runs, outputs, approvals, actions] = await Promise.all([
      this.store.taskInputs.listByTask(id),
      this.store.runs.listByTask(id),
      this.store.outputs.listByTask(id),
      this.store.approvals.listByTask(id),
      this.store.actions.listByTask(id),
    ]);
    const outputsWithCitations = await Promise.all(
      outputs.map(async (o) => ({
        ...o,
        citations: await this.store.citations.listByOutput(o.id),
      })),
    );
    return { ...task, inputs, runs, outputs: outputsWithCitations, approvals, actions };
  }

  list(filter: TaskFilter) {
    return this.store.tasks.list(filter);
  }

  async update(actor: AuthUser, id: string, patch: Partial<Task>): Promise<Task> {
    await this.get(id);
    const updated = await this.store.tasks.update(id, patch);
    if (!updated) throw ApiError.notFound('Task');
    await this.audit.record('task.updated', {
      taskId: id,
      actor: actor.email,
      payload: { patch },
    });
    return updated;
  }

  /** Tasks are never deleted — archive preserves the full audit trail. */
  async archive(actor: AuthUser, id: string): Promise<Task> {
    await this.get(id);
    const updated = await this.store.tasks.update(id, { status: 'archived' });
    if (!updated) throw ApiError.notFound('Task');
    await this.audit.record('task.archived', { taskId: id, actor: actor.email });
    return updated;
  }

  async addInput(
    actor: AuthUser,
    taskId: string,
    body: { input_type: InputType; content: string; source_document_id?: string | null },
  ): Promise<TaskInput> {
    await this.get(taskId);
    if (body.source_document_id) {
      const doc = await this.store.documents.get(body.source_document_id);
      if (!doc) throw ApiError.badRequest('source_document_id does not exist');
    }
    const input = await this.store.taskInputs.create({
      task_id: taskId,
      input_type: body.input_type,
      content: body.content,
      source_document_id: body.source_document_id ?? null,
    });
    await this.audit.record('input.added', {
      taskId,
      actor: actor.email,
      payload: { input_id: input.id, input_type: input.input_type },
    });
    return input;
  }

  async listInputs(taskId: string): Promise<TaskInput[]> {
    await this.get(taskId);
    return this.store.taskInputs.listByTask(taskId);
  }
}
