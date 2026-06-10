import express from 'express';
import type { AppConfig } from './config';
import { authMiddleware } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import type { Store } from './repositories/interfaces';
import { buildRouter } from './routes';
import { buildServices, type Services } from './services';

/** Wires the Express app from a store + config (testable composition root). */
export function buildApp(store: Store, config: AppConfig): { app: express.Express; services: Services } {
  const services = buildServices(store, config);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/ai', authMiddleware(config), buildRouter(services));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, services };
}
