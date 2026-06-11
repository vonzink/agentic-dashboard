import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  AiOutput,
  Company,
  ApprovalResponse,
  AuditEvent,
  Classification,
  DocumentDetail,
  DocumentType,
  HealthResponse,
  InputType,
  IntegrationAction,
  IntegrationStatus,
  OutputDetail,
  Paginated,
  PromptTemplate,
  ReviewQueueItem,
  RunResponse,
  SearchHit,
  SourceChunk,
  SourceDocument,
  Task,
  UsageSummary,
  TaskDetail,
  TaskInput,
  WorkflowGraph,
  WorkflowInfo,
} from './types';

type Query = Record<string, string | number | boolean | undefined | null>;

// ---------- system ----------

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiFetch<{ items: WorkflowInfo[] }>('/workflows'),
    staleTime: 5 * 60_000,
  });
}

export function useWorkflowGraphs() {
  return useQuery({
    queryKey: ['workflows', 'graph'],
    queryFn: () => apiFetch<{ items: WorkflowGraph[] }>('/workflows/graph'),
    staleTime: 5 * 60_000,
  });
}

export function useIntegrationsStatus() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => apiFetch<{ items: IntegrationStatus[] }>('/integrations/status'),
  });
}

// ---------- companies ----------

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: () => apiFetch<{ items: Company[] }>('/companies'),
    staleTime: 5 * 60_000,
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      apiFetch<Company>('/companies', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; is_active?: boolean }) =>
      apiFetch<Company>(`/companies/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

// ---------- tasks ----------

export function useTasks(query: Query) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: () => apiFetch<Paginated<Task>>('/tasks', { query }),
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => apiFetch<TaskDetail>(`/tasks/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      task_type: string;
      company_id?: string;
      priority?: string;
      assigned_to?: string;
      borrower_reference?: string;
      loan_reference?: string;
      due_at?: string;
      metadata_json?: Record<string, unknown>;
    }) => apiFetch<Task>('/tasks', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Task, 'title' | 'status' | 'priority' | 'assigned_to' | 'due_at' | 'metadata_json'>>) =>
      apiFetch<Task>(`/tasks/${taskId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useArchiveTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Task>(`/tasks/${taskId}/archive`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useAddTaskInput(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { input_type: InputType; content: string; source_document_id?: string }) =>
      apiFetch<TaskInput>(`/tasks/${taskId}/inputs`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId] }),
  });
}

export function useRunWorkflow(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      workflow_name: string;
      options?: { tone?: string; loan_type?: string; lender?: string; source_chunk_ids?: string[]; retrieve?: boolean };
    }) => apiFetch<RunResponse>(`/tasks/${taskId}/runs`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['outputs'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export function useTaskAudit(taskId: string | undefined) {
  return useQuery({
    queryKey: ['audit', 'task', taskId],
    queryFn: () => apiFetch<{ items: AuditEvent[] }>(`/tasks/${taskId}/audit`),
    enabled: Boolean(taskId),
  });
}

// ---------- outputs / approvals ----------

export function useReviewQueue(query: Query) {
  return useQuery({
    queryKey: ['outputs', 'queue', query],
    queryFn: () => apiFetch<Paginated<ReviewQueueItem>>('/outputs', { query }),
  });
}

export function useOutput(outputId: string | undefined) {
  return useQuery({
    queryKey: ['outputs', 'detail', outputId],
    queryFn: () => apiFetch<OutputDetail>(`/outputs/${outputId}`),
    enabled: Boolean(outputId),
  });
}

function useDecision(path: 'approve' | 'reject' | 'request-changes') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      outputId,
      body,
    }: {
      outputId: string;
      body: { reviewer_notes?: string; edited_final_content?: string };
    }) => apiFetch<ApprovalResponse>(`/outputs/${outputId}/${path}`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outputs'] });
      qc.invalidateQueries({ queryKey: ['task'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export const useApproveOutput = () => useDecision('approve');
export const useRejectOutput = () => useDecision('reject');
export const useRequestChanges = () => useDecision('request-changes');

export function useFinalizeOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (outputId: string) =>
      apiFetch<{ output: AiOutput }>(`/outputs/${outputId}/finalize`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['outputs'] });
      qc.invalidateQueries({ queryKey: ['task'] });
    },
  });
}

// ---------- documents ----------

export function useDocuments(query: Query) {
  return useQuery({
    queryKey: ['documents', query],
    queryFn: () => apiFetch<Paginated<SourceDocument>>('/documents', { query }),
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => apiFetch<DocumentDetail>(`/documents/${id}`),
    enabled: Boolean(id),
  });
}

export function useDocumentChunks(id: string | undefined) {
  return useQuery({
    queryKey: ['document', id, 'chunks'],
    queryFn: () => apiFetch<{ items: SourceChunk[] }>(`/documents/${id}/chunks`),
    enabled: Boolean(id),
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      filename: string;
      file_type?: string;
      company_id?: string;
      document_type?: DocumentType;
      classification?: Classification;
      s3_bucket?: string;
      s3_key?: string;
      content?: string;
      metadata_json?: Record<string, unknown>;
    }) => apiFetch<SourceDocument>('/documents', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useAddChunk(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content: string; page_number?: number; section_label?: string }) =>
      apiFetch<SourceChunk>(`/documents/${documentId}/chunks`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['document', documentId] }),
  });
}

// ---------- prompts ----------

export function usePrompts(query: Query = {}) {
  return useQuery({
    queryKey: ['prompts', query],
    queryFn: () => apiFetch<{ items: PromptTemplate[] }>('/prompts', { query }),
  });
}

export function useCreatePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      task_type: string;
      system_prompt: string;
      user_prompt_template: string;
      activate?: boolean;
    }) => apiFetch<PromptTemplate>('/prompts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
}

export function useSetPromptActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      apiFetch<PromptTemplate>(`/prompts/${id}`, { method: 'PATCH', body: { is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prompts'] }),
  });
}

// ---------- audit ----------

export function useAuditLog(query: Query) {
  return useQuery({
    queryKey: ['audit', 'global', query],
    queryFn: () => apiFetch<Paginated<AuditEvent>>('/audit', { query }),
  });
}

// ---------- integration actions ----------

export function useActions(query: Query) {
  return useQuery({
    queryKey: ['actions', query],
    queryFn: () => apiFetch<Paginated<IntegrationAction>>('/actions', { query }),
  });
}

export function useCreateAction(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      action_type: string;
      target_system: string;
      request_payload_json: Record<string, unknown>;
      approval_id?: string;
    }) => apiFetch<IntegrationAction>(`/tasks/${taskId}/actions`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', taskId] }),
  });
}

export function useExecuteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionId: string) =>
      apiFetch<IntegrationAction>(`/actions/${actionId}/execute`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task'] });
      qc.invalidateQueries({ queryKey: ['actions'] });
    },
  });
}

// ---------- retrieval ----------

export function useChunkSearch(q: string, k = 5, companyId?: string) {
  return useQuery({
    queryKey: ['search', q, k, companyId],
    queryFn: () =>
      apiFetch<{ items: SearchHit[]; model: string }>('/search', {
        query: { q, k, company_id: companyId },
      }),
    enabled: q.trim().length >= 2,
  });
}

// ---------- usage / cost ----------

export function useUsage(days = 30, companyId?: string) {
  return useQuery({
    queryKey: ['usage', days, companyId],
    queryFn: () => apiFetch<UsageSummary>('/usage', { query: { days, company_id: companyId } }),
    staleTime: 60_000,
  });
}
