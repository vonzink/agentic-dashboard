import type { AppConfig } from '../config';
import type { Store } from '../repositories/interfaces';
import { createProvider, type ModelProvider } from '../workflows/providers';
import { mockOutputFor } from '../workflows/registry';
import { ActionService } from './actions';
import { ApprovalService } from './approvals';
import { AuditService } from './audit';
import { CompanyService } from './companies';
import { DocumentService } from './documents';
import { LocalHashEmbedder, type EmbeddingProvider } from './embeddings';
import { PromptService } from './prompts';
import { RetrievalService } from './retrieval';
import { RunService } from './runs';
import { createStorage, type BlobStorage } from './storage';
import { TaskService } from './tasks';

export interface Services {
  audit: AuditService;
  companies: CompanyService;
  tasks: TaskService;
  documents: DocumentService;
  prompts: PromptService;
  runs: RunService;
  approvals: ApprovalService;
  actions: ActionService;
  provider: ModelProvider;
  storage: BlobStorage;
  embedder: EmbeddingProvider;
  retrieval: RetrievalService;
  store: Store;
  config: AppConfig;
}

export function buildServices(store: Store, config: AppConfig, storage?: BlobStorage): Services {
  const audit = new AuditService(store);
  const companies = new CompanyService(store, audit);
  const tasks = new TaskService(store, audit, companies);
  const blobStorage = storage ?? createStorage(config);
  const embedder = new LocalHashEmbedder();
  const retrieval = new RetrievalService(store, embedder);
  const documents = new DocumentService(store, audit, blobStorage, embedder, companies);
  const prompts = new PromptService(store, audit);
  const provider = createProvider(config, mockOutputFor);
  const runs = new RunService(store, audit, tasks, prompts, provider, config, retrieval);
  const approvals = new ApprovalService(store, audit, config);
  const actions = new ActionService(store, audit, config);
  return {
    audit, companies, tasks, documents, prompts, runs, approvals, actions,
    provider, storage: blobStorage, embedder, retrieval, store, config,
  };
}
