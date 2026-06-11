import nodemailer from 'nodemailer';
import type { AppConfig } from '../config';

/**
 * Outbound notifications for the human-in-the-loop flow: review-needed,
 * run-failed, and budget-threshold alerts. Notifications are best-effort —
 * a mail failure must NEVER fail the run or the approval flow, so every
 * send is wrapped and errors are only logged.
 *
 * Default is log-only. Email turns on when SMTP_* and NOTIFY_EMAILS are
 * configured (see .env.example). Bodies carry workflow/task metadata only —
 * never AI output content, which stays behind the dashboard login.
 */

export interface NotificationEvent {
  type: 'output.needs_review' | 'run.failed' | 'budget.threshold';
  subject: string;
  body: string;
}

export interface Notifier {
  readonly kind: string;
  send(event: NotificationEvent): Promise<void>;
}

/** Default sink when SMTP isn't configured: structured log line only. */
export class LogNotifier implements Notifier {
  readonly kind = 'log';
  async send(event: NotificationEvent): Promise<void> {
    console.log(
      JSON.stringify({ level: 'info', msg: 'notification', type: event.type, subject: event.subject }),
    );
  }
}

export class SmtpNotifier implements Notifier {
  readonly kind = 'smtp';
  private transport: nodemailer.Transporter;

  constructor(
    smtp: NonNullable<AppConfig['smtp']>,
    private recipients: string[],
  ) {
    this.transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
    });
    this.from = smtp.from;
  }
  private from: string;

  async send(event: NotificationEvent): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: this.recipients.join(', '),
      subject: event.subject,
      text: event.body,
    });
  }
}

export function createNotifier(config: AppConfig): Notifier {
  if (config.smtp && config.notifyEmails.length) {
    return new SmtpNotifier(config.smtp, config.notifyEmails);
  }
  return new LogNotifier();
}

export class NotificationService {
  constructor(
    private notifier: Notifier,
    private appBaseUrl: string | null,
  ) {}

  private link(path: string): string {
    return this.appBaseUrl ? `\n\nOpen: ${this.appBaseUrl}${path}` : '';
  }

  /** Best-effort dispatch; never throws. */
  private async dispatch(event: NotificationEvent): Promise<void> {
    try {
      await this.notifier.send(event);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'notification failed',
          type: event.type,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  outputNeedsReview(p: {
    taskTitle: string;
    workflowName: string;
    outputId: string;
    confidence: string;
    warningCount: number;
  }): Promise<void> {
    return this.dispatch({
      type: 'output.needs_review',
      subject: `[Agentic AI] Review needed: ${p.taskTitle}`,
      body:
        `An AI draft is waiting for human review.\n\n` +
        `Task: ${p.taskTitle}\nWorkflow: ${p.workflowName}\n` +
        `Confidence: ${p.confidence}\nWarnings: ${p.warningCount}` +
        this.link(`/approvals?output=${p.outputId}`),
    });
  }

  runFailed(p: { taskTitle: string; workflowName: string; error: string }): Promise<void> {
    return this.dispatch({
      type: 'run.failed',
      subject: `[Agentic AI] Run failed: ${p.taskTitle}`,
      body:
        `A workflow run failed and was recorded in the audit trail.\n\n` +
        `Task: ${p.taskTitle}\nWorkflow: ${p.workflowName}\nError: ${p.error}` +
        this.link('/tasks'),
    });
  }

  budgetThreshold(p: {
    companyName: string;
    threshold: number;
    ratio: number;
    monthlyBudget: string;
    monthToDate: string;
  }): Promise<void> {
    const pct = Math.round(p.threshold * 100);
    return this.dispatch({
      type: 'budget.threshold',
      subject: `[Agentic AI] ${p.companyName} passed ${pct}% of its monthly AI budget`,
      body:
        `${p.companyName} has used ${Math.round(p.ratio * 100)}% of its ` +
        `$${p.monthlyBudget} monthly AI budget ($${p.monthToDate} so far). ` +
        `Budgets are soft limits — runs continue to work.` +
        this.link('/'),
    });
  }
}
