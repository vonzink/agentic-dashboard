import { AUTH_MODE, authHeaders, clearTokens } from '../lib/identity';
import type { ApiErrorBody } from './types';

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

if (USE_MOCKS) {
  // The mock module is only imported when mocks are explicitly enabled.
  const mod = await import('../mocks/mockFetch');
  fetchImpl = mod.mockFetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export function buildQuery(
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `/api/ai${path}${buildQuery(options.query)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is the backend running?');
  }

  if (!response.ok) {
    // Cognito session expired/revoked: drop tokens so AuthGate re-prompts.
    if (response.status === 401 && AUTH_MODE === 'cognito') clearTokens();
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(
      response.status,
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ?? `Request failed with status ${response.status}`,
      body?.error?.details,
    );
  }

  return (await response.json()) as T;
}

/** Human-friendly message for known error situations. */
export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'EXECUTION_DISABLED') {
      return 'Action execution is disabled in this environment. No external action was taken.';
    }
    if (err.status === 403) {
      return `Not permitted: ${err.message}`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/** Multipart upload (no JSON content-type; browser sets the boundary). */
export async function apiUpload<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  let response: Response;
  try {
    response = await fetchImpl(`/api/ai${path}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: form as unknown as BodyInit,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the API. Is the backend running?');
  }
  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(
      response.status,
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ?? `Upload failed with status ${response.status}`,
      body?.error?.details,
    );
  }
  return (await response.json()) as T;
}
