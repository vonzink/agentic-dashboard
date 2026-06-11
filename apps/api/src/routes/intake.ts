import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Services } from '../services';
import { ApiError } from '../middleware/error';
import type { TaskType } from '../types/statuses';

/**
 * Email intake: forward an email (via Zapier / Make / GHL webhook) and it
 * becomes an open task with the email body attached as an input. No AI
 * runs automatically — an operator picks the workflow and runs it, so the
 * human-initiation invariant holds even for machine-created tasks.
 *
 * Mounted OUTSIDE the user-auth router; callers authenticate with the
 * INTAKE_TOKEN shared secret instead of a Cognito JWT. Disabled entirely
 * when INTAKE_TOKEN is unset.
 */

const intakeEmailBody = z.object({
  from: z.string().min(3).max(320),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  /** Optional explicit client; defaults to the founding company. */
  company_slug: z.string().max(100).optional(),
});

/** Cheap keyword routing for the initial task type; operators can rerun
 * any workflow regardless, so a miss here costs nothing. */
export function guessTaskType(subject: string, body: string): TaskType {
  const text = `${subject}\n${body}`.toLowerCase();
  if (/\bcondition(s)?\b|\bunderwrit/i.test(text)) return 'condition_response';
  if (/\bchecklist\b|\bwhat documents\b|\bdocs needed\b/.test(text)) return 'document_checklist';
  if (/\bsop\b|\bguideline(s)?\b|\bpolicy\b/.test(text)) return 'sop_lookup';
  return 'general';
}

const tokensMatch = (a: string, b: string) => {
  // Constant-time comparison over fixed-length digests.
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
};

export function buildIntakeRouter(s: Services): Router {
  const r = Router();

  r.post('/email', async (req, res, next) => {
    try {
      const token = s.config.intakeToken;
      if (!token) {
        throw new ApiError(503, 'INTAKE_DISABLED', 'Email intake is not configured (INTAKE_TOKEN unset)');
      }
      const presented = req.header('x-intake-token') ?? '';
      if (!presented || !tokensMatch(presented, token)) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid intake token');
      }

      const body = intakeEmailBody.parse(req.body);
      const company = body.company_slug
        ? await s.store.companies.getBySlug(body.company_slug)
        : null;
      if (body.company_slug && !company) {
        throw ApiError.badRequest(`Unknown company_slug '${body.company_slug}'`);
      }

      const taskType = guessTaskType(body.subject, body.body);
      const actor = { email: `intake:${body.from}`, role: 'operator' as const };
      const task = await s.tasks.create(actor, {
        title: body.subject.slice(0, 300),
        task_type: taskType,
        priority: 'normal',
        company_id: company?.id ?? null,
        metadata_json: { intake: 'email', from: body.from, subject: body.subject },
      });
      await s.tasks.addInput(actor, task.id, {
        input_type: taskType === 'sop_lookup' ? 'question' : taskType === 'condition_response' ? 'condition_text' : 'other',
        content: body.body,
      });

      res.status(201).json({ task_id: task.id, task_type: taskType, status: task.status });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
