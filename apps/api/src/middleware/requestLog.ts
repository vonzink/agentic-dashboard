import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Structured request logging with request-id correlation
 * (docs/AGENTIC_DASHBOARD_AWS_DEPLOYMENT.md §7: JSON logs + request IDs
 * for CloudWatch). Honors an inbound x-request-id (e.g. from an ALB) and
 * always echoes it back so clients can quote it in bug reports.
 */
export function requestLog(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id')?.slice(0, 64) ?? randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      if (req.path.endsWith('/health')) return; // keep probes out of the logs
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(
        JSON.stringify({
          time: new Date().toISOString(),
          level: res.statusCode >= 500 ? 'error' : 'info',
          request_id: requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          duration_ms: Math.round(ms),
          user: req.user?.email ?? null,
        }),
      );
    });
    next();
  };
}
