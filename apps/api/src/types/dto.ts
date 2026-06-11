import { z } from 'zod';
import {
  ACTION_STATUSES,
  CLASSIFICATIONS,
  DOCUMENT_TYPES,
  INPUT_TYPES,
  REVIEW_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from './statuses';

/** Request validation schemas for every /api/ai endpoint. */

const jsonObject = z.record(z.string(), z.unknown());

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const createTaskBody = z.object({
  title: z.string().min(1).max(300),
  task_type: z.enum(TASK_TYPES),
  company_id: z.uuid().nullish(),
  project_id: z.uuid().nullish(),
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  assigned_to: z.string().email().nullish(),
  // References are opaque identifiers only. Never put borrower PII here.
  borrower_reference: z.string().max(100).nullish(),
  loan_reference: z.string().max(100).nullish(),
  due_at: z.iso.datetime({ offset: true }).nullish(),
  metadata_json: jsonObject.default({}),
});

export const updateTaskBody = z
  .object({
    title: z.string().min(1).max(300),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    assigned_to: z.string().email().nullable(),
    due_at: z.iso.datetime({ offset: true }).nullable(),
    metadata_json: jsonObject,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'empty patch' });

export const listTasksQuery = paginationQuery.extend({
  company_id: z.uuid().optional(),
  project_id: z.uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  task_type: z.enum(TASK_TYPES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigned_to: z.string().optional(),
  search: z.string().max(200).optional(),
});

export const createInputBody = z.object({
  input_type: z.enum(INPUT_TYPES),
  content: z.string().min(1).max(50_000),
  source_document_id: z.uuid().nullish(),
});

export const createRunBody = z.object({
  workflow_name: z.string().min(1),
  options: z
    .object({
      tone: z.string().max(60).optional(),
      loan_type: z.string().max(60).optional(),
      lender: z.string().max(100).optional(),
      employment_type: z.string().max(60).optional(),
      property_type: z.string().max(60).optional(),
      occupancy: z.string().max(60).optional(),
      special_scenario: z.string().max(500).optional(),
      source_chunk_ids: z.array(z.uuid()).max(20).optional(),
      retrieve: z.boolean().optional(),
    })
    .default({}),
});

export const searchQuery = z.object({
  q: z.string().min(2).max(500),
  k: z.coerce.number().int().min(1).max(20).default(5),
  company_id: z.uuid().optional(),
});

export const usageQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  company_id: z.uuid().optional(),
});

export const createCompanyBody = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits, hyphens'),
});

export const updateCompanyBody = z
  .object({
    name: z.string().min(1).max(200),
    is_active: z.boolean(),
    monthly_budget: z.number().nonnegative().max(1_000_000).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'empty patch' });

export const budgetQuery = z.object({ company_id: z.uuid().optional() });

/** Projects registry. github_repo is 'owner/name' — repos stay private. */
const githubRepo = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "expected 'owner/name', e.g. vonzink/msfg-calc");

export const createProjectBody = z.object({
  name: z.string().min(1).max(200),
  company_id: z.uuid().nullish(),
  description: z.string().max(2_000).nullish(),
  github_repo: githubRepo.nullish(),
  live_url: z.url().max(500).nullish(),
  notes: z.string().max(10_000).nullish(),
});

export const updateProjectBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    github_repo: githubRepo.nullable(),
    live_url: z.url().max(500).nullable(),
    status: z.enum(['active', 'paused', 'archived']),
    notes: z.string().max(10_000).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'empty patch' });

export const listProjectsQuery = z.object({ company_id: z.uuid().optional() });

/** Eval sets: cases are synthetic test inputs — never borrower data. */
export const createEvalCaseBody = z.object({
  workflow_name: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  primary_text: z.string().min(1).max(20_000),
  source_text: z.string().max(50_000).nullish(),
  contains: z.array(z.string().min(1).max(500)).max(20).optional(),
  min_confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
});

export const updateEvalCaseBody = z.object({ is_active: z.boolean() });

export const runEvalsBody = z.object({
  workflow_name: z.string().min(1).max(100),
  prompt_id: z.uuid().optional(),
});

export const listEvalsQuery = z.object({ workflow_name: z.string().max(100).optional() });

/** PATCH /workflows/:name — admin tuning of a workflow's config.
 * model_config_json replaces the whole object; {} clears routing. */
export const updateWorkflowBody = z
  .object({
    requires_approval: z.boolean(),
    is_active: z.boolean(),
    model_config_json: z
      .object({
        provider: z.enum(['mock', 'anthropic', 'openai', 'deepseek']).optional(),
        model: z.string().min(1).max(200).optional(),
      })
      .strict(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'empty patch' });

export const approveBody = z.object({
  reviewer_notes: z.string().max(5_000).nullish(),
  edited_final_content: z.string().max(100_000).nullish(),
});

export const rejectBody = z.object({
  reviewer_notes: z.string().min(1).max(5_000),
});

export const listOutputsQuery = paginationQuery.extend({
  review_status: z.enum(REVIEW_STATUSES).optional(),
});

export const createDocumentBody = z.object({
  filename: z.string().min(1).max(300),
  file_type: z.string().max(100).nullish(),
  document_type: z.enum(DOCUMENT_TYPES).default('manual_snippet'),
  classification: z.enum(CLASSIFICATIONS).default('internal'),
  s3_bucket: z.string().max(255).nullish(),
  s3_key: z.string().max(1024).nullish(),
  /** Manual snippet text; stored as chunk 0 of the document. */
  content: z.string().max(100_000).nullish(),
  company_id: z.uuid().nullish(),
  metadata_json: jsonObject.default({}),
});

/** Multipart text fields accompanying POST /documents/upload. */
export const uploadDocumentFields = z.object({
  document_type: z.enum(DOCUMENT_TYPES).default('other'),
  classification: z.enum(CLASSIFICATIONS).default('internal'),
  company_id: z.uuid().nullish(),
});

export const listDocumentsQuery = paginationQuery.extend({
  document_type: z.enum(DOCUMENT_TYPES).optional(),
  company_id: z.uuid().optional(),
});

export const createChunkBody = z.object({
  content: z.string().min(1).max(100_000),
  page_number: z.number().int().min(1).nullish(),
  section_label: z.string().max(200).nullish(),
});

export const createPromptBody = z.object({
  name: z.string().min(1).max(120),
  task_type: z.enum(TASK_TYPES),
  system_prompt: z.string().min(1).max(50_000),
  user_prompt_template: z.string().min(1).max(50_000),
  activate: z.boolean().default(false),
});

export const updatePromptBody = z.object({
  is_active: z.boolean(),
});

export const listPromptsQuery = z.object({
  name: z.string().optional(),
  task_type: z.enum(TASK_TYPES).optional(),
});

export const listAuditQuery = paginationQuery.extend({
  company_id: z.uuid().optional(),
  event_type: z.string().optional(),
  actor: z.string().optional(),
  task_id: z.uuid().optional(),
});

export const createActionBody = z.object({
  action_type: z.string().min(1).max(100),
  target_system: z.string().min(1).max(100),
  request_payload_json: jsonObject.default({}),
  approval_id: z.uuid().nullish(),
});

export const listActionsQuery = paginationQuery.extend({
  status: z.enum(ACTION_STATUSES).optional(),
});
