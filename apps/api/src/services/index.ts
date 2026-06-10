import type { AppConfig } from '../config';
import type { Store } from '../repositories/interfaces';
import { createProvider, type ModelProvider } from '../workflows/providers';
import { mockOutputFor } from '../workflows/registry';
import { ActionService } from './actions';
import { ApprovalService } from './approvals';
import { AuditService } from './audit';
import { DocumentService } from './documents';
import { PromptService } from './prompts';
import { RunService } from './runs';
import { TaskService } from './tasks';

export interface Services {
  audit: AuditService;
  tasks: TaskService;
  documents: DocumentService;
  prompts: PromptService;
  runs: RunService;
  approvals: ApprovalService;
  actions: ActionService;
  provider: ModelProvider;
  store: Store;
  config: AppConfig;
}

export function buildServices(store: Store, config: AppConfig): Services {
  const audit = new AuditService(store);
  const tasks = new TaskService(store, audit);
  const documents = new DocumentService(store, audit);
  const prompts = new PromptService(store, audit);
  const provider = createProvider(config, mockOutputFor);
  const runs = new RunService(store, audit, tasks, prompts, provider, config);
  const approvals = new ApprovalService(store, audit, config);
  const actions = new ActionService(store, audit, config);
  return { audit, tasks, documents, prompts, runs, approvals, actions, provider, store, config };
}
