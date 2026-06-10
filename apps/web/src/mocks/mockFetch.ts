/**
 * MOCK DATA LAYER — loaded ONLY when VITE_USE_MOCKS=true.
 * Entirely synthetic fixtures ("Test Borrower A"); no borrower data.
 * Read-only: mutations return an error explaining mocks are active.
 * A visible "MOCK DATA" badge is shown in the top bar while active.
 */

const now = new Date().toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const task = {
  id: id(1),
  title: 'Respond to paystub condition (MOCK)',
  task_type: 'condition_response',
  status: 'waiting_review',
  priority: 'high',
  created_by: 'mock@msfg.local',
  assigned_to: null,
  borrower_reference: 'BRW-TEST-001',
  loan_reference: 'LN-TEST-001',
  due_at: null,
  metadata_json: {},
  created_at: now,
  updated_at: now,
};

const output = {
  id: id(2),
  task_run_id: id(3),
  output_type: 'draft_response',
  content: 'Mock draft response for Test Borrower A.',
  structured_json: {
    summary: 'The underwriter requests 30 days of paystubs. (mock)',
    missing_items: ['Most recent paystub'],
    recommended_next_steps: ['Request paystub from Test Borrower A'],
    draft_response: 'Dear Underwriting, please find the requested paystubs attached. (mock)',
    citations: [],
    confidence_label: 'MEDIUM',
    requires_human_review: true,
    warnings: ['No source documents were provided — verify against the loan file. (mock)'],
  },
  confidence_label: 'MEDIUM',
  requires_human_review: true,
  review_status: 'NEEDS_REVIEW',
  created_at: now,
  citations: [],
  task_id: id(1),
  task_title: task.title,
  workflow_name: 'condition_response_draft',
  approvals: [],
};

const run = {
  id: id(3), task_id: id(1), workflow_name: 'condition_response_draft',
  langgraph_run_id: id(4), model_provider: 'mock', model_name: 'mock-model-v1',
  prompt_version: 'condition_response_draft@1', status: 'succeeded',
  requested_by: 'mock@msfg.local', started_at: now, completed_at: now,
  error_message: null, token_input_count: 100, token_output_count: 80,
  estimated_cost: '0', created_at: now,
};

const ROUTES: [RegExp, () => unknown][] = [
  [/^\/health/, () => ({ status: 'ok', db: 'skipped', provider: { name: 'mock', configured: true }, version: 'mock' })],
  [/^\/workflows/, () => ({
    items: [{
      id: id(5), workflow_name: 'condition_response_draft', task_type: 'condition_response',
      requires_approval: true, allowed_tools_json: [], model_config_json: {}, is_active: true,
      created_at: now, updated_at: now, implemented: true,
      description: 'Mock workflow',
    }],
  })],
  [/^\/integrations\/status/, () => ({ items: [{ name: 'noop', status: 'not_configured', detail: 'mocks active' }] })],
  [/^\/tasks\/[^/]+\/audit/, () => ({ items: [{ id: 1, task_id: id(1), actor_user_id: 'mock@msfg.local', event_type: 'task.created', event_payload_json: {}, created_at: now }] })],
  [/^\/tasks\/[^/]+\/(inputs|runs|outputs)/, () => ({ items: [] })],
  [/^\/tasks\/[^/]+/, () => ({ ...task, inputs: [], runs: [run], outputs: [output], approvals: [], actions: [] })],
  [/^\/tasks/, () => ({ items: [task], page: 1, pageSize: 20, total: 1 })],
  [/^\/runs\//, () => ({ ...run, outputs: [output] })],
  [/^\/outputs\/[^/]+/, () => output],
  [/^\/outputs/, () => ({ items: [output], page: 1, pageSize: 20, total: 1 })],
  [/^\/documents/, () => ({ items: [], page: 1, pageSize: 20, total: 0 })],
  [/^\/prompts/, () => ({ items: [] })],
  [/^\/audit/, () => ({ items: [], page: 1, pageSize: 25, total: 0 })],
  [/^\/actions/, () => ({ items: [], page: 1, pageSize: 20, total: 0 })],
];

export async function mockFetch(input: string, init?: RequestInit): Promise<Response> {
  const path = input.replace(/^\/api\/ai/, '').split('?')[0] ?? '';
  if (init?.method && init.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: { code: 'MOCKS_ACTIVE', message: 'Mock mode is read-only. Set VITE_USE_MOCKS=false to use the real API.' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) {
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No mock for ${path}` } }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(hit[1]()), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
