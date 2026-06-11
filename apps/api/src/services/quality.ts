import type { Store } from '../repositories/interfaces';

/**
 * Reviewer-edit analytics: how often outputs get approved, and how heavily
 * reviewers edit what the AI drafted. Because every approval stores both the
 * original draft and the reviewer's final edited content, this is a direct,
 * free measure of AI quality per workflow — no extra instrumentation.
 */

export interface QualityBucket {
  decisions: number;
  approved: number;
  rejected: number;
  changes_requested: number;
  /** Approvals where the reviewer edited the draft before approving. */
  approved_with_edits: number;
  /** Mean word-level edit distance ratio (0 = untouched, 1 = rewritten),
   * averaged across approved outputs. */
  avg_edit_ratio: number;
}

export interface QualitySummary {
  days: number;
  since: string;
  totals: QualityBucket;
  by_workflow: ({ workflow_name: string } & QualityBucket)[];
}

const MAX_WORDS = 400; // caps the O(n*m) distance computation per approval

/** Word-level Levenshtein distance ratio between draft and final content. */
export function editRatio(original: string, edited: string): number {
  const a = original.trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  const b = edited.trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  if (!a.length && !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    prev = curr;
  }
  return prev[b.length]! / Math.max(a.length, b.length);
}

export class QualityService {
  constructor(private store: Store) {}

  async summary(days: number, companyId?: string): Promise<QualitySummary> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await this.store.approvals.listDecisionsSince(since, companyId);

    const bucket = (): QualityBucket & { editRatioSum: number } => ({
      decisions: 0,
      approved: 0,
      rejected: 0,
      changes_requested: 0,
      approved_with_edits: 0,
      avg_edit_ratio: 0,
      editRatioSum: 0,
    });
    const totals = bucket();
    const byWorkflow = new Map<string, ReturnType<typeof bucket>>();

    for (const row of rows) {
      const w = byWorkflow.get(row.workflow_name) ?? bucket();
      for (const b of [totals, w]) {
        b.decisions += 1;
        if (row.decision === 'rejected') b.rejected += 1;
        if (row.decision === 'changes_requested') b.changes_requested += 1;
        if (row.decision === 'approved') {
          b.approved += 1;
          const edited =
            row.edited_final_content !== null &&
            row.edited_final_content.trim() !== row.output_content.trim();
          if (edited) {
            b.approved_with_edits += 1;
            b.editRatioSum += editRatio(row.output_content, row.edited_final_content!);
          }
        }
      }
      byWorkflow.set(row.workflow_name, w);
    }

    const finish = ({ editRatioSum, ...b }: ReturnType<typeof bucket>): QualityBucket => ({
      ...b,
      avg_edit_ratio: b.approved ? Number((editRatioSum / b.approved).toFixed(3)) : 0,
    });

    return {
      days,
      since,
      totals: finish(totals),
      by_workflow: [...byWorkflow.entries()]
        .map(([workflow_name, b]) => ({ workflow_name, ...finish(b) }))
        .sort((a, b) => b.decisions - a.decisions),
    };
  }
}
