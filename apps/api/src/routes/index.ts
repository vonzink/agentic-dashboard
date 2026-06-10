import { Router, type Request } from 'express';
import multer from 'multer';
import type { Services } from '../services';
import { currentUser, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/error';
import {
  approveBody,
  createActionBody,
  createChunkBody,
  createCompanyBody,
  createDocumentBody,
  createInputBody,
  createPromptBody,
  createRunBody,
  createTaskBody,
  listActionsQuery,
  listAuditQuery,
  listDocumentsQuery,
  listOutputsQuery,
  listPromptsQuery,
  listTasksQuery,
  rejectBody,
  searchQuery,
  updateCompanyBody,
  updatePromptBody,
  updateTaskBody,
  usageQuery,
  uploadDocumentFields,
} from '../types/dto';
import { PLANNED_WORKFLOWS, WORKFLOWS } from '../workflows/registry';

/**
 * Full /api/ai contract. Role minimums:
 *   viewer   — read everything
 *   operator — create tasks/inputs/documents, run workflows, propose actions
 *   reviewer — approve/reject/request-changes/finalize, execute actions
 *   admin    — prompt & workflow administration
 */
/** Express 5 types params loosely; assert presence once. */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) {
    throw ApiError.badRequest(`Missing path parameter '${name}'`);
  }
  return value;
}

export function buildRouter(s: Services): Router {
  const r = Router();

  // ----- system ------------------------------------------------------------
  r.get('/health', async (_req, res) => {
    const db = await s.store.ping();
    res.json({
      status: 'ok',
      db,
      provider: {
        name: s.provider.name,
        model: s.provider.model,
        // A non-mock provider can only be constructed with its key present.
        configured: true,
      },
      version: '0.1.0',
    });
  });

  r.get('/workflows', requireRole('viewer'), async (_req, res) => {
    const configs = await s.store.workflowConfigs.list();
    const items = configs.map((c) => {
      const impl = WORKFLOWS[c.workflow_name];
      const planned = PLANNED_WORKFLOWS.find((p) => p.workflow_name === c.workflow_name);
      return {
        ...c,
        implemented: !!impl,
        description: impl?.description ?? planned?.description ?? '',
      };
    });
    res.json({ items });
  });

  r.get('/integrations/status', requireRole('viewer'), (_req, res) => {
    const planned = ['monday', 'lendingpad', 'ghl', 'gmail', 'outlook', 's3', 'zapier_make_n8n'];
    res.json({
      items: [
        {
          name: 'noop',
          status: s.config.integrationExecutionEnabled ? 'ok' : 'not_configured',
          detail: s.config.integrationExecutionEnabled
            ? 'Simulated executor enabled'
            : 'Execution disabled (propose-only mode)',
        },
        ...planned.map((name) => ({
          name,
          status: 'not_configured' as const,
          detail: 'Planned — see docs/AGENTIC_DASHBOARD_INTEGRATIONS_ROADMAP.md',
        })),
      ],
    });
  });

  // ----- companies ----------------------------------------------------------
  r.get('/companies', requireRole('viewer'), async (_req, res) => {
    res.json({ items: await s.companies.list() });
  });

  r.post('/companies', requireRole('admin'), async (req, res) => {
    const body = createCompanyBody.parse(req.body);
    res.status(201).json(await s.companies.create(currentUser(req), body));
  });

  r.patch('/companies/:id', requireRole('admin'), async (req, res) => {
    const body = updateCompanyBody.parse(req.body);
    res.json(await s.companies.update(currentUser(req), param(req, 'id'), body));
  });

  // ----- tasks --------------------------------------------------------------
  r.post('/tasks', requireRole('operator'), async (req, res) => {
    const body = createTaskBody.parse(req.body);
    res.status(201).json(await s.tasks.create(currentUser(req), body));
  });

  r.get('/tasks', requireRole('viewer'), async (req, res) => {
    res.json(await s.tasks.list(listTasksQuery.parse(req.query)));
  });

  r.get('/tasks/:id', requireRole('viewer'), async (req, res) => {
    res.json(await s.tasks.detail(param(req, 'id')));
  });

  r.patch('/tasks/:id', requireRole('operator'), async (req, res) => {
    const body = updateTaskBody.parse(req.body);
    res.json(await s.tasks.update(currentUser(req), param(req, 'id'), body));
  });

  r.post('/tasks/:id/archive', requireRole('operator'), async (req, res) => {
    res.json(await s.tasks.archive(currentUser(req), param(req, 'id')));
  });

  // ----- task inputs ----------------------------------------------------------
  r.post('/tasks/:id/inputs', requireRole('operator'), async (req, res) => {
    const body = createInputBody.parse(req.body);
    res.status(201).json(await s.tasks.addInput(currentUser(req), param(req, 'id'), body));
  });

  r.get('/tasks/:id/inputs', requireRole('viewer'), async (req, res) => {
    res.json({ items: await s.tasks.listInputs(param(req, 'id')) });
  });

  // ----- runs -----------------------------------------------------------------
  r.post('/tasks/:id/runs', requireRole('operator'), async (req, res) => {
    const body = createRunBody.parse(req.body);
    const result = await s.runs.run(currentUser(req), param(req, 'id'), body.workflow_name, body.options);
    res.status(201).json(result);
  });

  r.get('/tasks/:id/runs', requireRole('viewer'), async (req, res) => {
    res.json({ items: await s.runs.listByTask(param(req, 'id')) });
  });

  r.get('/runs/:runId', requireRole('viewer'), async (req, res) => {
    res.json(await s.runs.get(param(req, 'runId')));
  });

  // ----- outputs / approvals ---------------------------------------------------
  r.get('/outputs', requireRole('viewer'), async (req, res) => {
    res.json(await s.approvals.listOutputs(listOutputsQuery.parse(req.query)));
  });

  r.get('/tasks/:id/outputs', requireRole('viewer'), async (req, res) => {
    await s.tasks.get(param(req, 'id'));
    res.json({ items: await s.approvals.listOutputsByTask(param(req, 'id')) });
  });

  r.get('/outputs/:outputId', requireRole('viewer'), async (req, res) => {
    res.json(await s.approvals.getOutput(param(req, 'outputId')));
  });

  r.post('/outputs/:outputId/approve', requireRole('reviewer'), async (req, res) => {
    const body = approveBody.parse(req.body);
    res.json(await s.approvals.approve(currentUser(req), param(req, 'outputId'), body));
  });

  r.post('/outputs/:outputId/reject', requireRole('reviewer'), async (req, res) => {
    const body = rejectBody.parse(req.body);
    res.json(await s.approvals.reject(currentUser(req), param(req, 'outputId'), body));
  });

  r.post('/outputs/:outputId/request-changes', requireRole('reviewer'), async (req, res) => {
    const body = rejectBody.parse(req.body);
    res.json(await s.approvals.requestChanges(currentUser(req), param(req, 'outputId'), body));
  });

  r.post('/outputs/:outputId/finalize', requireRole('reviewer'), async (req, res) => {
    res.json(await s.approvals.finalize(currentUser(req), param(req, 'outputId')));
  });

  // ----- documents -------------------------------------------------------------
  const uploads = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  r.post('/documents/upload', requireRole('operator'), uploads.single('file'), async (req, res) => {
    if (!req.file) throw ApiError.badRequest("multipart field 'file' is required");
    const meta = uploadDocumentFields.parse(req.body ?? {});
    const doc = await s.documents.upload(currentUser(req), req.file, meta);
    res.status(201).json(doc);
  });

  r.post('/documents', requireRole('operator'), async (req, res) => {
    const body = createDocumentBody.parse(req.body);
    res.status(201).json(await s.documents.create(currentUser(req), body));
  });

  r.get('/documents', requireRole('viewer'), async (req, res) => {
    res.json(await s.documents.list(listDocumentsQuery.parse(req.query)));
  });

  r.get('/documents/:id', requireRole('viewer'), async (req, res) => {
    res.json(await s.documents.detail(param(req, 'id')));
  });

  r.get('/documents/:id/chunks', requireRole('viewer'), async (req, res) => {
    res.json({ items: await s.documents.listChunks(param(req, 'id')) });
  });

  r.post('/documents/:id/chunks', requireRole('operator'), async (req, res) => {
    const body = createChunkBody.parse(req.body);
    res.status(201).json(await s.documents.addChunk(currentUser(req), param(req, 'id'), body));
  });

  r.post('/documents/:id/extract', requireRole('operator'), async (req, res) => {
    res.json(await s.documents.reextract(currentUser(req), param(req, 'id')));
  });

  // ----- retrieval ---------------------------------------------------------------
  r.get('/search', requireRole('viewer'), async (req, res) => {
    const { q, k, company_id } = searchQuery.parse(req.query);
    res.json({ items: await s.retrieval.search(q, k, company_id), model: s.embedder.model });
  });

  // ----- usage / cost reporting ----------------------------------------------------
  r.get('/usage', requireRole('viewer'), async (req, res) => {
    const { days, company_id } = usageQuery.parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    res.json({ days, ...(await s.store.runs.usageSummary(since, company_id)) });
  });

  // ----- prompts (admin) ----------------------------------------------------------
  r.get('/prompts', requireRole('viewer'), async (req, res) => {
    res.json({ items: await s.prompts.list(listPromptsQuery.parse(req.query)) });
  });

  r.post('/prompts', requireRole('admin'), async (req, res) => {
    const body = createPromptBody.parse(req.body);
    res.status(201).json(await s.prompts.createVersion(currentUser(req), body));
  });

  r.patch('/prompts/:id', requireRole('admin'), async (req, res) => {
    const body = updatePromptBody.parse(req.body);
    res.json(await s.prompts.setActive(currentUser(req), param(req, 'id'), body.is_active));
  });

  // ----- audit ----------------------------------------------------------------------
  r.get('/tasks/:id/audit', requireRole('viewer'), async (req, res) => {
    await s.tasks.get(param(req, 'id'));
    res.json({ items: await s.store.audit.listByTask(param(req, 'id')) });
  });

  r.get('/audit', requireRole('viewer'), async (req, res) => {
    res.json(await s.store.audit.list(listAuditQuery.parse(req.query)));
  });

  // ----- integration actions --------------------------------------------------------
  r.post('/tasks/:id/actions', requireRole('operator'), async (req, res) => {
    const body = createActionBody.parse(req.body);
    res.status(201).json(await s.actions.propose(currentUser(req), param(req, 'id'), body));
  });

  r.get('/actions', requireRole('viewer'), async (req, res) => {
    res.json(await s.actions.list(listActionsQuery.parse(req.query)));
  });

  r.post('/actions/:id/execute', requireRole('reviewer'), async (req, res) => {
    res.json(await s.actions.execute(currentUser(req), param(req, 'id')));
  });

  return r;
}
