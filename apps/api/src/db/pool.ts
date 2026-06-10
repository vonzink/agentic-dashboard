import pg from 'pg';

/**
 * int8 (bigint) → number. Safe here: the only bigint column is
 * ai_audit_events.id, which will not exceed 2^53 in this system's lifetime.
 */
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export type { Pool } from 'pg';
