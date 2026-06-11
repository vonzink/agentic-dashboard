import type { GitHubRepoMeta } from '../types/domain';

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
}

/** Used when GITHUB_TOKEN is unset: registry works, sync explains itself. */
export class DisabledGitHubClient implements GitHubClient {
  async getRepo(): Promise<GitHubRepoMeta> {
    throw new Error('GitHub sync is not configured (GITHUB_TOKEN unset)');
  }
  async getReadme(): Promise<null> {
    throw new Error('GitHub sync is not configured (GITHUB_TOKEN unset)');
  }
}

export function createGitHubClient(token: string | null): GitHubClient {
  return token ? new RealGitHubClient(token) : new DisabledGitHubClient();
}
