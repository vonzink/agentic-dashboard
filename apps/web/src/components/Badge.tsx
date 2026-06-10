import { titleCase } from '../lib/format';

type Tone = 'neutral' | 'green' | 'teal' | 'amber' | 'red' | 'dark';

const TONES: Record<string, Tone> = {
  // task status
  open: 'teal', in_progress: 'teal', waiting_review: 'amber', changes_requested: 'amber',
  completed: 'green', archived: 'neutral', cancelled: 'neutral',
  // priority
  low: 'neutral', normal: 'teal', high: 'amber', urgent: 'red',
  // run status
  pending: 'neutral', running: 'teal', succeeded: 'green', failed: 'red',
  // review status
  DRAFT: 'neutral', AI_GENERATED: 'teal', NEEDS_REVIEW: 'amber', APPROVED: 'green',
  REJECTED: 'red', CHANGES_REQUESTED: 'amber', FINALIZED: 'green',
  ACTION_SENT: 'dark', ACTION_COMPLETED: 'dark',
  // confidence
  HIGH: 'green', MEDIUM: 'amber', LOW: 'red',
  // actions
  proposed: 'amber', approved: 'green', executing: 'teal', executed: 'dark',
  // classification
  public: 'neutral', internal: 'teal', borrower_pii: 'red',
  // extraction
  not_applicable: 'neutral', manual: 'teal',
};

export function Badge({ value, prefix }: { value: string; prefix?: string }) {
  const tone = TONES[value] ?? 'neutral';
  const label = value === value.toUpperCase() ? value.replace(/_/g, ' ') : titleCase(value);
  return (
    <span className={`badge ${tone}`}>
      {prefix ? `${prefix}: ` : ''}
      {label}
    </span>
  );
}
