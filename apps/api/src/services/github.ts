import type { GitHubRepoMeta } from '../types/domain';
import type { TreeEntry } from './repoScan';

/**
 * Read-only GitHub access for the Projects registry. Uses a fine-grained
 * personal access token (GITHUB_TOKEN env; Contents+Metadata read-only,
 * scoped to the linked repos) so repos can stay PRIVATE. The token never
 * appears in errors, logs, or API payloads.
 */

export interface GitHubClient {
  /** Repo metadata, or a clear error when the repo is missing/inaccessible. */
  getRepo(ownerRepo: string): Promise<GitHubRepoMeta>;
  /** README content + blob sha, or null when the repo has no README. */
  getReadme(ownerRepo: string): Promise<{ content: string; sha: string } | null>;
  /** Full recursive file tree of a branch (paths + types). */
  getTree(ownerRepo: string, branch: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  /** Bytes per language. */
  getLanguages(ownerRepo: string): Promise<Record<string, number>>;
  /** Text content of one file, or null when missing/binary/oversized. */
  getFile(ownerRepo: string, path: string): Promise<string | null>;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function assertRepoFormat(ownerRepo: string): void {
  if (!REPO_RE.test(ownerRepo)) {
    throw new Error(`github_repo must look like 'owner/name', got '${ownerRepo}'`);
  }
}

export class RealGitHubClient implements GitHubClient {
  constructor(private token: string) {}

  private async request(path: string, accept: string): Promise<Response> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'agentic-dashboard',
      },
    });
    return res;
  }

  async getRepo(ownerRepo: string): Promise<GitHubRepoMeta> {
    assertRepoFormat(ownerRepo);
    const res = await this.request(`/repos/${ownerRepo}`, 'application/vnd.github+json');
    if (res.status === 404) {
      // 404 covers both "doesn't exist" and "token can't see it" by design.
      throw new Error(`GitHub repo '${ownerRepo}' not found or the token lacks access to it`);
    }
    if (!res.ok) {
      throw new Error(`GitHub API error for '${ownerRepo}': HTTP ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      description: (body.description as string | null) ?? null,
      default_branch: (body.default_branch as string) ?? 'main',
      pushed_at: (body.pushed_at as string | null) ?? null,
      open_issues: (body.open_issues_count as number) ?? 0,
      stars: (body.stargazers_count as number) ?? 0,
      private: Boolean(body.private),
      html_url: (body.html_url as string) ?? `https://github.com/${ownerRepo}`,
    };
  }

  async getReadme(ownerRepo: string): Promise<{ content: string; sha: string } | null> {
    assertRepoFormat(ownerRepo);
    const res = await this.request(`/repos/${ownerRepo}/readme`, 'application/vnd.github+json');
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`GitHub API error for '${ownerRepo}' README: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { content?: string; encoding?: string; sha?: string };
    if (!body.content || !body.sha) return null;
    const content =
      body.encoding === 'base64'
        ? Buffer.from(body.content, 'base64').toString('utf8')
        : body.content;
    return { content, sha: body.sha };
  }

  async getTree(
    ownerRepo: string,
    branch: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    assertRepoFormat(ownerRepo);
    const res = await this.request(
      `/repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      'application/vnd.github+json',
    );
    if (!res.ok) throw new Error(`GitHub API error for '${ownerRepo}' tree: HTTP ${res.status}`);
    const body = (await res.json()) as {
      tree?: { path: string; type: string; size?: number }[];
      truncated?: boolean;
    };
    return {
      entries: (body.tree ?? [])
        .filter((t) => t.type === 'blob' || t.type === 'tree')
        .map((t) => ({ path: t.path, type: t.type as 'blob' | 'tree', size: t.size })),
      truncated: Boolean(body.truncated),
    };
  }

  async getLanguages(ownerRepo: string): Promise<Record<string, number>> {
    assertRepoFormat(ownerRepo);
    const res = await this.request(`/repos/${ownerRepo}/languages`, 'application/vnd.github+json');
    if (!res.ok) return {};
    return (await res.json()) as Record<string, number>;
  }

  async getFile(ownerRepo: string, path: string): Promise<string | null> {
    assertRepoFormat(ownerRepo);
    const res = await this.request(
      `/repos/${ownerRepo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
      'application/vnd.github+json',
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: string; encoding?: string; size?: number };
    if (!body.content || body.encoding !== 'base64' || (body.size ?? 0) > 200_000) return null;
    return Buffer.from(body.content, 'base64').toString('utf8');
  }
}

/** Used when GITHUB_TOKEN is unset: registry works, sync explains itself. */
export class DisabledGitHubClient implements GitHubClient {
  private fail(): never {
    throw new Error('GitHub sync is not configured (GITHUB_TOKEN unset)');
  }
  async getRepo(): Promise<GitHubRepoMeta> {
    this.fail();
  }
  async getReadme(): Promise<null> {
    this.fail();
  }
  async getTree(): Promise<never> {
    this.fail();
  }
  async getLanguages(): Promise<never> {
    this.fail();
  }
  async getFile(): Promise<null> {
    this.fail();
  }
}

export function createGitHubClient(token: string | null): GitHubClient {
  return token ? new RealGitHubClient(token) : new DisabledGitHubClient();
}
