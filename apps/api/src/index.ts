import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { MemoryStore } from './repositories/memory';
import { PgStore } from './repositories/pg';
import type { Store } from './repositories/interfaces';
import { seedDefaults } from './services/seed';

async function main() {
  const config = loadConfig();

  let store: Store;
  if (config.databaseUrl) {
    store = new PgStore(createPool(config.databaseUrl));
    if ((await store.ping()) !== 'up') {
      console.error('DATABASE_URL is set but the database is unreachable.');
      console.error('Start it with: docker compose up -d postgres && npm run db:migrate && npm run db:seed');
      process.exit(1);
    }
  } else {
    // DB-less local mode: volatile in-memory store, auto-seeded.
    console.warn('[warn] DATABASE_URL not set — using in-memory store (data is NOT persisted)');
    store = new MemoryStore();
  }
  await seedDefaults(store);

  const { app } = buildApp(store, config);
  app.listen(config.port, () => {
    console.log(
      `agentic-dashboard API listening on :${config.port} ` +
        `(env=${config.env}, auth=${config.authMode}, provider=${config.modelProvider}, ` +
        `db=${config.databaseUrl ? 'postgres' : 'memory'})`,
    );
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
