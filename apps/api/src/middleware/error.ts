import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(what: string) {
    return new ApiError(404, 'NOT_FOUND', `${what} not found`);
  }
  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static forbidden(code: string, message: string) {
    return new ApiError(403, code, message);
  }
  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues },
    });
    return;
  }
  // Unknown error: log it with the request id, return a generic message
  // (no internals leak); clients can quote the id from the x-request-id
  // header when reporting issues.
  console.error(`[error] request_id=${req.requestId ?? '-'} ${req.method} ${req.path}`, err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: { request_id: req.requestId } },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
