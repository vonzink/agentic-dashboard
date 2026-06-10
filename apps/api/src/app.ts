import express from 'express';
import type { AppConfig } from './config';
import { authMiddleware } from './middleware/auth';
import type { CognitoVerifier } from './middleware/cognito';
import { errorHandler, notFoundHandler } from './middleware/error';
import { requestLog } from './middleware/requestLog';
import type { Store } from './repositories/interfaces';
import { buildRouter } from './routes';
import { buildServices, type Services } from './services';
import type { BlobStorage } from './services/storage';

/** Wires the Express app from a store + config (testable composition root).
 * `deps` lets tests inject a CognitoVerifier (local JWKS) or a BlobStorage. */
export function buildApp(
  store: Store,
  config: AppConfig,
  deps: { verifier?: CognitoVerifier; storage?: BlobStorage } = {},
): { app: express.Express; services: Services } {
  const services = buildServices(store, config, deps.storage);
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLog());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/ai', authMiddleware(config, deps.verifier), buildRouter(services));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, services };
}
