/**
 * Deterministic repo structure scan (Layer 1 of project mapping).
 * Pure functions over data already fetched from GitHub — parsing, not
 * generation, so the Structure tab can never hallucinate. The AI
 * architecture-map workflow (Layer 2) consumes this as ground truth.
 */

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface RepoDirectory {
  path: string;
  role: 'frontend' | 'backend' | 'database' | 'infra' | 'docs' | 'tests' | 'other';
  file_count: number;
  /** Why it was classified this way (shown in the UI). */
  signals: string[];
}

export interface RepoStructure {
  default_branch: string;
  total_files: number;
  tree_truncated: boolean;
  /** Bytes per language, from the GitHub languages API. */
  languages: Record<string, number>;
  /** Detected technologies (manifests + marker files). */
  stack: string[];
  directories: RepoDirectory[];
  scanned_at: string;
}

/** npm dependencies worth surfacing as stack entries. */
const NPM_STACK: Record<string, string> = {
  react: 'React',
  next: 'Next.js',
  vue: 'Vue',
  svelte: 'Svelte',
  vite: 'Vite',
  express: 'Express',
  fastify: 'Fastify',
  '@langchain/langgraph': 'LangGraph',
  '@anthropic-ai/sdk': 'Anthropic SDK',
  openai: 'OpenAI SDK',
  pg: 'Postgres (pg)',
  prisma: 'Prisma',
  mongoose: 'MongoDB (mongoose)',
  tailwindcss: 'Tailwind CSS',
  typescript: 'TypeScript',
  electron: 'Electron',
};

/** Python requirements worth surfacing. */
const PY_STACK: Record<string, string> = {
  flask: 'Flask',
  django: 'Django',
  fastapi: 'FastAPI',
  langchain: 'LangChain',
  anthropic: 'Anthropic SDK',
  openai: 'OpenAI SDK',
  streamlit: 'Streamlit',
  pandas: 'pandas',
};

/** Marker files anywhere in the tree → stack entries. */
const FILE_MARKERS: [RegExp, string][] = [
  [/(^|\/)Dockerfile$/, 'Docker'],
  [/(^|\/)docker-compose[^/]*\.ya?ml$/, 'Docker Compose'],
  [/\.tf$/, 'Terraform'],
  [/(^|\/)\.github\/workflows\//, 'GitHub Actions'],
  [/(^|\/)serverless\.ya?ml$/, 'Serverless Framework'],
  [/(^|\/)vercel\.json$/, 'Vercel'],
  [/(^|\/)netlify\.toml$/, 'Netlify'],
  [/(^|\/)migrations\/.*\.sql$/, 'SQL migrations'],
  [/(^|\/)requirements\.txt$/, 'Python'],
];

const DIR_NAME_ROLES: [RegExp, RepoDirectory['role'], string][] = [
  [/^(web|frontend|client|ui|app|www|site|public)$/i, 'frontend', 'directory name'],
  [/^(api|server|backend|functions|lambda)$/i, 'backend', 'directory name'],
  [/^(migrations|db|database|sql)$/i, 'database', 'directory name'],
  [/^(infra|infrastructure|terraform|deploy|deployment|ops|\.github)$/i, 'infra', 'directory name'],
  [/^(docs?|documentation)$/i, 'docs', 'directory name'],
  [/^(tests?|__tests__|spec|e2e|cypress)$/i, 'tests', 'directory name'],
];

/** Paths whose contents we fetch for dependency detection (root + 2 levels). */
export function manifestPathsToFetch(entries: TreeEntry[]): string[] {
  return entries
    .filter(
      (e) =>
        e.type === 'blob' &&
        /(^|\/)(package\.json|requirements\.txt)$/.test(e.path) &&
        !e.path.includes('node_modules/') &&
        e.path.split('/').length <= 3,
    )
    .map((e) => e.path)
    .slice(0, 8);
}

function detectStack(entries: TreeEntry[], manifests: Record<string, string>): string[] {
  const stack = new Set<string>();
  for (const [path, content] of Object.entries(manifests)) {
    if (path.endsWith('package.json')) {
      try {
        const pkg = JSON.parse(content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        stack.add('Node.js');
        for (const [dep, label] of Object.entries(NPM_STACK)) {
          if (deps[dep]) stack.add(label);
        }
      } catch {
        // unparseable manifest: skip silently, facts only
      }
    } else if (path.endsWith('requirements.txt')) {
      const lines = content.toLowerCase();
      stack.add('Python');
      for (const [req, label] of Object.entries(PY_STACK)) {
        if (new RegExp(`(^|\\n)${req}([=<>~\\[]|\\s|$)`).test(lines)) stack.add(label);
      }
    }
  }
  for (const entry of entries) {
    for (const [re, label] of FILE_MARKERS) {
      if (re.test(entry.path)) stack.add(label);
    }
  }
  return [...stack].sort();
}

const EXT_SIGNALS: [RegExp, RepoDirectory['role'], string][] = [
  [/\.(tsx|jsx|vue|svelte|css|scss|html)$/, 'frontend', 'UI files'],
  [/\.sql$/, 'database', 'SQL files'],
  [/\.tf$/, 'infra', 'Terraform files'],
  [/\.(test|spec)\.[jt]sx?$/, 'tests', 'test files'],
  [/\.md$/, 'docs', 'markdown files'],
];

/** Classifies the top-level directories (descending one level into common
 * monorepo wrappers like apps/ and packages/). */
function classifyDirectories(entries: TreeEntry[]): RepoDirectory[] {
  const blobs = entries.filter((e) => e.type === 'blob' && !e.path.includes('node_modules/'));

  // Group files by their top-level segment; descend into apps/* and packages/*.
  const groups = new Map<string, string[]>();
  for (const b of blobs) {
    const segments = b.path.split('/');
    if (segments.length === 1) continue; // root files handled by stack detection
    let key = segments[0]!;
    if (/^(apps|packages|services)$/.test(key) && segments.length > 2) {
      key = `${segments[0]}/${segments[1]}`;
    }
    groups.set(key, [...(groups.get(key) ?? []), b.path]);
  }

  const dirs: RepoDirectory[] = [];
  for (const [path, files] of groups) {
    const name = path.split('/').pop()!;
    const signals: string[] = [];
    let role: RepoDirectory['role'] | null = null;

    for (const [re, r, why] of DIR_NAME_ROLES) {
      if (re.test(name)) {
        role = r;
        signals.push(why);
        break;
      }
    }

    // Extension majority vote (also recorded as signals).
    const votes = new Map<RepoDirectory['role'], number>();
    for (const file of files) {
      for (const [re, r, why] of EXT_SIGNALS) {
        if (re.test(file)) {
          votes.set(r, (votes.get(r) ?? 0) + 1);
          if (!signals.includes(why)) signals.push(why);
        }
      }
    }
    if (!role) {
      const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      // Backend default: plain ts/js source with no UI/db/infra majority.
      role = top && top[1] >= Math.max(2, files.length * 0.2) ? top[0] : null;
      if (!role && files.some((f) => /\.[jt]s$/.test(f))) {
        role = 'backend';
        signals.push('server-side source files');
      }
    }

    dirs.push({ path, role: role ?? 'other', file_count: files.length, signals });
  }
  return dirs.sort((a, b) => b.file_count - a.file_count);
}

export function scanRepo(input: {
  default_branch: string;
  entries: TreeEntry[];
  truncated: boolean;
  languages: Record<string, number>;
  manifests: Record<string, string>;
}): RepoStructure {
  return {
    default_branch: input.default_branch,
    total_files: input.entries.filter((e) => e.type === 'blob').length,
    tree_truncated: input.truncated,
    languages: input.languages,
    stack: detectStack(input.entries, input.manifests),
    directories: classifyDirectories(input.entries),
    scanned_at: new Date().toISOString(),
  };
}
