import { friendlyErrorMessage } from '../api/client';

export function Loading() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="banner error">
      {friendlyErrorMessage(error)}{' '}
      {onRetry && (
        <button className="btn sm ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <p>{message}</p>
      {action}
    </div>
  );
}
