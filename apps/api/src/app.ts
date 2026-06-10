import express from 'express';
import type { AppConfig } from './config';
import { authMiddleware } from './middleware/auth';
import type { CognitoVerifier } from './middleware/cognito';
import { errorHandler, notFoundHandler } from './middleware/error';
import type { Store } from './repositories/interfaces';
import { buildRouter } from './routes';
import { buildServices, type Services } from './services';

/** Wires the Express app from a store + config (testable composition root).
 * `verifier` lets tests inject a CognitoVerifier backed by a local JWKS. */
export function buildApp(
  store: Store,
  config: AppConfig,
  verifier?: CognitoVerifier,
): { app: express.Express; services: Services } {
  const services = buildServices(store, config);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/ai', authMiddleware(config, verifier), buildRouter(services));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, services };
}
