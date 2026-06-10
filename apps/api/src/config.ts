import 'dotenv/config';

/**
 * All runtime configuration comes from environment variables.
 * No secrets are ever hard-coded; see /.env.example at the repo root.
 */
export interface AppConfig {
  env: 'local' | 'dev' | 'staging' | 'production';
  port: number;
  /** 'dev' = trusted x-user-* headers (local only). 'cognito' = Cognito JWT verification. */
  authMode: 'dev' | 'cognito';
  /** Required when authMode is 'cognito'. */
  cognito: { region: string; userPoolId: string; clientId: string } | null;
  databaseUrl: string | null;
  modelProvider: 'mock' | 'anthropic';
  anthropicApiKey: string | null;
  anthropicModel: string;
  /** USD per 1M tokens, for estimated_cost on runs. */
  costPerMTokIn: number;
  costPerMTokOut: number;
  /** Reviewers may not approve their own runs when true (recommended outside local). */
  requireDifferentReviewer: boolean;
  /** Master switch for executing integration actions. Off = propose-only mode. */
  integrationExecutionEnabled: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (process.env.APP_ENV ?? 'local') as AppConfig['env'];
  const config: AppConfig = {
    env,
    port: Number(process.env.PORT ?? 4000),
    authMode: (process.env.AUTH_MODE ?? 'dev') as AppConfig['authMode'],
    cognito:
      process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_REGION && process.env.COGNITO_CLIENT_ID
        ? {
            region: process.env.COGNITO_REGION,
            userPoolId: process.env.COGNITO_USER_POOL_ID,
            clientId: process.env.COGNITO_CLIENT_ID,
          }
        : null,
    databaseUrl: process.env.DATABASE_URL ?? null,
    modelProvider: (process.env.MODEL_PROVIDER ?? 'mock') as AppConfig['modelProvider'],
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    costPerMTokIn: Number(process.env.COST_PER_MTOK_IN ?? 5),
    costPerMTokOut: Number(process.env.COST_PER_MTOK_OUT ?? 25),
    requireDifferentReviewer: process.env.REQUIRE_DIFFERENT_REVIEWER === 'true',
    integrationExecutionEnabled: process.env.INTEGRATION_EXECUTION_ENABLED === 'true',
    ...overrides,
  };

  if (config.env === 'production' && config.authMode === 'dev') {
    throw new Error('AUTH_MODE=dev is forbidden when APP_ENV=production');
  }
  if (config.authMode === 'cognito' && !config.cognito) {
    throw new Error(
      'AUTH_MODE=cognito requires COGNITO_USER_POOL_ID, COGNITO_REGION, and COGNITO_CLIENT_ID',
    );
  }
  if (config.modelProvider === 'anthropic' && !config.anthropicApiKey) {
    throw new Error('MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }
  return config;
}
