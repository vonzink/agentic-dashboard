import { loadConfig } from '../config';
import { PgStore } from '../repositories/pg';
import { seedDefaults } from '../services/seed';
import { createPool } from './pool';

// CLI entrypoint: npm run db:seed — workflow configs + v1 prompts. Idempotent.
const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required to seed the database');
  process.exit(1);
}
const pool = createPool(config.databaseUrl);
seedDefaults(new PgStore(pool))
  .then(async () => {
    console.log('Seeded workflow configs and default prompt templates');
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
