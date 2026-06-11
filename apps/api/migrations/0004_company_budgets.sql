-- Per-company monthly AI spend budget (USD). NULL = no budget set.
-- Soft limit: the dashboard warns as month-to-date spend approaches it;
-- runs are never blocked (a hard stop could freeze compliance work).
ALTER TABLE ai_companies ADD COLUMN monthly_budget numeric(12,2);
