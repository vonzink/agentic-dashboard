import { describe, expect, it } from 'vitest';
import { NotificationService } from '../src/services/notifications';
import { buildTestApp, taskWithOutput } from './helpers';

describe('notifications', () => {
  it('emits output.needs_review when a run produces a draft', async () => {
    const { app, notifier } = await buildTestApp();
    const { task } = await taskWithOutput(app);

    const events = notifier.events.filter((e) => e.type === 'output.needs_review');
    expect(events).toHaveLength(1);
    expect(events[0]!.subject).toContain(task.title);
    expect(events[0]!.body).toContain('condition_response_draft');
    // Notification bodies carry metadata only — never AI output content.
    expect(events[0]!.body).not.toContain('Dear Underwriting');
  });

  it('includes a dashboard link when APP_BASE_URL is set', async () => {
    const { app, notifier } = await buildTestApp({ appBaseUrl: 'https://agentic.example.com' });
    const { output } = await taskWithOutput(app);
    const event = notifier.events.find((e) => e.type === 'output.needs_review')!;
    expect(event.body).toContain(`https://agentic.example.com/approvals?output=${output.id}`);
  });

  it('alerts once when spend crosses a budget threshold, with an audit event', async () => {
    const { app, store, services, notifier } = await buildTestApp();
    const msfg = (await store.companies.getBySlug('msfg'))!;
    await store.companies.update(msfg.id, { monthly_budget: '100.00' });

    const { run } = await taskWithOutput(app);
    await store.runs.update(run.id, { estimated_cost: '85.000000' });

    // This run's $85 moved MTD spend from $0 to $85 — crosses 80%.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (services.runs as any).checkBudgetThresholds(msfg.id, 'operator@test.local', 85);
    const warn = notifier.events.filter((e) => e.type === 'budget.threshold');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.subject).toContain('80%');

    // Same spend again: no re-alert (already past 80%, not yet 100%).
    await (services.runs as any).checkBudgetThresholds(msfg.id, 'operator@test.local', 5);
    expect(notifier.events.filter((e) => e.type === 'budget.threshold')).toHaveLength(1);

    // Crossing 100% alerts again.
    await store.runs.update(run.id, { estimated_cost: '105.000000' });
    await (services.runs as any).checkBudgetThresholds(msfg.id, 'operator@test.local', 20);
    const over = notifier.events.filter((e) => e.type === 'budget.threshold');
    expect(over).toHaveLength(2);
    expect(over[1]!.subject).toContain('100%');

    const audit = await store.audit.list({ page: 1, pageSize: 50, event_type: 'budget.threshold_crossed' });
    expect(audit.total).toBe(2);
  });

  it('never throws when the notifier fails', async () => {
    const failing = {
      kind: 'broken',
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const service = new NotificationService(failing, null);
    await expect(
      service.runFailed({ taskTitle: 't', workflowName: 'w', error: 'x' }),
    ).resolves.toBeUndefined();
  });
});
