import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { createPool } from './pool';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Minimal, transparent migration runner: applies migrations/NNNN_*.sql in
 * filename order, each inside a transaction, recording applied filenames in
 * schema_migrations. Migrations must be additive/backward-compatible within
 * a release (see docs/AGENTIC_DASHBOARD_DATABASE.md).
 */
export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const pool = createPool(databaseUrl);
  const applied: string[] = [];
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const done = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
  return applied;
}

// CLI entrypoint: npm run db:migrate
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is required to run migrations');
    process.exit(1);
  }
  runMigrations(config.databaseUrl)
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date');
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
