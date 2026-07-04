import type { TreeEntry } from './repoScan';

/**
 * Code-level import graph (the "Obsidian brain" view). Deterministic:
 * source files are fetched from GitHub and their import statements parsed
 * with regexes — no AI involved, so every node and edge is a fact. File
 * count is capped to stay inside GitHub rate limits; the cap is always
 * reported, never silent.
 */

export interface ImportGraphNode {
  /** Repo-relative path, or 'pkg:<name>' for an external package. */
  id: string;
  /** Top-level directory ('.' for root files, 'pkg' for externals). */
  dir: string;
  external: boolean;
  /** Out-degree / in-degree within the graph. */
  imports: number;
  imported_by: number;
}

export interface ImportGraph {
  nodes: ImportGraphNode[];
  edges: { from: string; to: string }[];
  files_scanned: number;
  files_skipped: number;
  scanned_at: string;
}

const SOURCE_RE = /\.(tsx?|jsx?|mjs|cjs|py)$/;
const EXCLUDE_RE = /(^|\/)(node_modules|dist|build|coverage|\.next|vendor|__pycache__)\/|\.min\.|\.d\.ts$/;

export const IMPORT_SCAN_FILE_CAP = 150;

/** Source files worth scanning, smallest paths first, capped. */
export function pickSourceFiles(entries: TreeEntry[], cap = IMPORT_SCAN_FILE_CAP) {
  const all = entries
    .filter((e) => e.type === 'blob' && SOURCE_RE.test(e.path) && !EXCLUDE_RE.test(e.path))
    .map((e) => e.path)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return { files: all.slice(0, cap), skipped: Math.max(0, all.length - cap) };
}

const JS_IMPORT_RE =
  /(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
const PY_IMPORT_RE = /^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import|import[ \t]+([\w.]+))/gm;

/** Import specifiers appearing in one source file. */
export function extractImports(path: string, content: string): string[] {
  const specs: string[] = [];
  if (path.endsWith('.py')) {
    for (const m of content.matchAll(PY_IMPORT_RE)) specs.push((m[1] ?? m[2])!);
  } else {
    for (const m of content.matchAll(JS_IMPORT_RE)) specs.push(m[1]!);
  }
  return specs;
}

const JS_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Resolves a specifier to a repo file, an external package, or null. */
export function resolveImport(
  fromPath: string,
  spec: string,
  fileSet: Set<string>,
): string | null {
  const fromDir = fromPath.split('/').slice(0, -1).join('/');
  if (fromPath.endsWith('.py')) {
    if (spec.startsWith('.')) {
      const ups = spec.match(/^\.+/)![0].length;
      const rest = spec.slice(ups).replace(/\./g, '/');
      const base = fromDir.split('/').slice(0, fromDir ? -(ups - 1) || undefined : 0);
      const target = normalize([...base, rest].filter(Boolean).join('/'));
      for (const suffix of ['.py', '/__init__.py']) {
        if (fileSet.has(target + suffix)) return target + suffix;
      }
      return null;
    }
    const target = spec.replace(/\./g, '/');
    for (const suffix of ['.py', '/__init__.py']) {
      if (fileSet.has(target + suffix)) return target + suffix;
    }
    return `pkg:${spec.split('.')[0]}`;
  }

  if (spec.startsWith('.')) {
    const target = normalize(`${fromDir}/${spec}`);
    for (const suffix of JS_SUFFIXES) {
      if (fileSet.has(target + suffix)) return target + suffix;
    }
    return null;
  }
  // Bare specifier → external package (scoped packages keep two segments).
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;
  return `pkg:${name}`;
}

/**
 * Builds the graph from fetched file contents. External packages appear as
 * nodes only when imported by ≥ 2 files (single-use packages are noise).
 */
export function buildImportGraph(
  files: Record<string, string>,
  skipped: number,
): ImportGraph {
  const fileSet = new Set(Object.keys(files));
  const rawEdges: { from: string; to: string }[] = [];

  for (const [path, content] of Object.entries(files)) {
    const seen = new Set<string>();
    for (const spec of extractImports(path, content)) {
      const target = resolveImport(path, spec, fileSet);
      if (!target || target === path || seen.has(target)) continue;
      seen.add(target);
      rawEdges.push({ from: path, to: target });
    }
  }

  const pkgUse = new Map<string, number>();
  for (const e of rawEdges) {
    if (e.to.startsWith('pkg:')) pkgUse.set(e.to, (pkgUse.get(e.to) ?? 0) + 1);
  }
  const edges = rawEdges.filter((e) => !e.to.startsWith('pkg:') || pkgUse.get(e.to)! >= 2);

  const ids = new Set<string>([...fileSet, ...edges.map((e) => e.to)]);
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  const nodes: ImportGraphNode[] = [...ids].map((id) => ({
    id,
    dir: id.startsWith('pkg:') ? 'pkg' : id.includes('/') ? id.split('/')[0]! : '.',
    external: id.startsWith('pkg:'),
    imports: outDeg.get(id) ?? 0,
    imported_by: inDeg.get(id) ?? 0,
  }));

  return {
    nodes,
    edges,
    files_scanned: fileSet.size,
    files_skipped: skipped,
    scanned_at: new Date().toISOString(),
  };
}
