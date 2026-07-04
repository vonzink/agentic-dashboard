import request from 'supertest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MemoryStore } from '../src/repositories/memory';
import type { GitHubClient } from '../src/services/github';
import { seedDefaults } from '../src/services/seed';
import type { GitHubRepoMeta } from '../src/types/domain';
import { as, MemoryBlobStorage } from './helpers';

/** Deterministic GitHub double — tests never touch the network. */
export class FakeGitHub implements GitHubClient {
  meta: GitHubRepoMeta = {
    description: 'MSFG mortgage calculator',
    default_branch: 'main',
    pushed_at: '2026-06-10T12:00:00Z',
    open_issues: 2,
    stars: 0,
    private: true,
    html_url: 'https://github.com/vonzink/msfg-calc',
  };
  readme: { content: string; sha: string } | null = {
    content: '# msfg-calc\n\nRate and payment calculators for MSFG.',
    sha: 'sha-v1',
  };
  async getRepo(ownerRepo: string): Promise<GitHubRepoMeta> {
    if (ownerRepo === 'vonzink/missing') {
      throw new Error(`GitHub repo '${ownerRepo}' not found or the token lacks access to it`);
    }
    return this.meta;
  }
  async getReadme(): Promise<{ content: string; sha: string } | null> {
    return this.readme;
  }
  tree = {
    entries: [
      { path: 'web', type: 'tree' as const },
      { path: 'web/package.json', type: 'blob' as const },
      { path: 'web/src/App.tsx', type: 'blob' as const },
      { path: 'web/src/styles.css', type: 'blob' as const },
      { path: 'server', type: 'tree' as const },
      { path: 'server/package.json', type: 'blob' as const },
      { path: 'server/index.ts', type: 'blob' as const },
      { path: 'migrations/0001_init.sql', type: 'blob' as const },
      { path: 'Dockerfile', type: 'blob' as const },
      { path: 'README.md', type: 'blob' as const },
    ],
    truncated: false,
  };
  async getTree() {
    return this.tree;
  }
  async getLanguages(): Promise<Record<string, number>> {
    return { TypeScript: 9000, CSS: 800 };
  }
  /** Per-test overridable file contents (import-graph tests). */
  files: Record<string, string> = {};
  async getFile(_repo: string, path: string): Promise<string | null> {
    if (this.files[path] !== undefined) return this.files[path];
    if (path === 'web/package.json') {
      return JSON.stringify({ dependencies: { react: '^18', vite: '^5' } });
    }
    if (path === 'server/package.json') {
      return JSON.stringify({ dependencies: { express: '^4', pg: '^8' } });
    }
    return null;
  }
}

export async function buildProjectApp() {
  const config = loadConfig({
    env: 'local',
    authMode: 'dev',
    databaseUrl: null,
    modelProvider: 'mock',
    smtp: null,
    appBaseUrl: null,
    githubToken: 'fake-token-not-real',
  });
  const store = new MemoryStore();
  await seedDefaults(store);
  const github = new FakeGitHub();
  const { app, services } = buildApp(store, config, {
    storage: new MemoryBlobStorage(),
    github,
  });
  return { app, store, services, github };
}

export const createProject = (app: Parameters<typeof request>[0], body: object = {}) =>
  request(app)
    .post('/api/ai/projects')
    .set(as.admin)
    .send({ name: 'msfg-calc', github_repo: 'vonzink/msfg-calc', ...body });
