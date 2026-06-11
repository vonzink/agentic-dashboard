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
  modelProvider: 'mock' | 'anthropic' | 'openai' | 'deepseek';
  anthropicApiKey: string | null;
  anthropicModel: string;
  openaiApiKey: string | null;
  openaiModel: string;
  deepseekApiKey: string | null;
  deepseekModel: string;
  /** USD per 1M tokens, for estimated_cost on runs. */
  costPerMTokIn: number;
  costPerMTokOut: number;
  /** Document blob storage: S3 when set, local disk otherwise. */
  s3Bucket: string | null;
  uploadDir: string;
  /** Reviewers may not approve their own runs when true (recommended outside local). */
  requireDifferentReviewer: boolean;
  /** Master switch for executing integration actions. Off = propose-only mode. */
  integrationExecutionEnabled: boolean;
  /** Recipients of review/failure/budget alert emails. Empty = log-only. */
  notifyEmails: string[];
  /** SMTP transport for notifications; null = log-only notifier. */
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string | null;
    from: string;
  } | null;
  /** Public dashboard URL used in notification links (e.g. https://agentic.zvzsolutions.com). */
  appBaseUrl: string | null;
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
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? null,
    deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    costPerMTokIn: Number(process.env.COST_PER_MTOK_IN ?? 5),
    costPerMTokOut: Number(process.env.COST_PER_MTOK_OUT ?? 25),
    s3Bucket: process.env.S3_BUCKET ?? null,
    uploadDir: process.env.UPLOAD_DIR ?? '.data/uploads',
    requireDifferentReviewer: process.env.REQUIRE_DIFFERENT_REVIEWER === 'true',
    integrationExecutionEnabled: process.env.INTEGRATION_EXECUTION_ENABLED === 'true',
    notifyEmails: (process.env.NOTIFY_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
    smtp: process.env.SMTP_HOST
      ? {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 587),
          secure: process.env.SMTP_SECURE === 'true',
          user: process.env.SMTP_USER ?? null,
          pass: process.env.SMTP_PASS ?? null,
          from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'agentic-dashboard@localhost',
        }
      : null,
    appBaseUrl: process.env.APP_BASE_URL ?? null,
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
  if (config.modelProvider === 'openai' && !config.openaiApiKey) {
    throw new Error('MODEL_PROVIDER=openai requires OPENAI_API_KEY');
  }
  if (config.modelProvider === 'deepseek' && !config.deepseekApiKey) {
    throw new Error('MODEL_PROVIDER=deepseek requires DEEPSEEK_API_KEY');
  }
  return config;
}
