import { useMemo, useState } from 'react';
import type { ImportGraph } from '../api/types';

/**
 * Obsidian-style force-directed graph of a project's import structure.
 * Layout: Fruchterman–Reingold, precomputed (deterministic seed, no
 * animation loop). Nodes colored by top-level directory using a
 * CVD-validated categorical palette (identity is never color-alone:
 * a legend lists directories and hover/click names the file).
 */

// Validated (dataviz six checks, light surface): blue red gold green purple orange.
const DIR_PALETTE = ['#3B6FD4', '#C6425A', '#9A6A00', '#2E7D32', '#8A4FBE', '#C05717'];
const OTHER_COLOR = '#6f7a76';
const PKG_COLOR = '#9aa4a0';

const W = 860;
const H = 560;

interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  dir: string;
  external: boolean;
  degree: number;
}

/** Deterministic PRNG so the layout is stable across renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout(graph: ImportGraph): { nodes: LaidOutNode[]; dirColors: Map<string, string> } {
  const nodes = graph.nodes;
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const rand = mulberry32(42);

  // Fixed-order directory → color assignment (largest directories first).
  const dirCounts = new Map<string, number>();
  for (const n of nodes) {
    if (!n.external) dirCounts.set(n.dir, (dirCounts.get(n.dir) ?? 0) + 1);
  }
  const dirColors = new Map<string, string>();
  [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([dir], i) => dirColors.set(dir, i < DIR_PALETTE.length ? DIR_PALETTE[i]! : OTHER_COLOR));

  const xs = nodes.map(() => rand() * W);
  const ys = nodes.map(() => rand() * H);
  const edges = graph.edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter(([a, b]) => a !== undefined && b !== undefined) as [number, number][];

  const n = nodes.length || 1;
  const k = Math.sqrt((W * H) / n);
  let temperature = W / 8;
  const iterations = Math.min(300, 80 + n * 2);

  for (let iter = 0; iter < iterations; iter++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = xs[i]! - xs[j]!;
        let vy = ys[i]! - ys[j]!;
        let d2 = vx * vx + vy * vy;
        if (d2 < 0.01) {
          vx = rand() - 0.5;
          vy = rand() - 0.5;
          d2 = vx * vx + vy * vy;
        }
        const f = (k * k) / d2;
        dx[i]! += vx * f; dy[i]! += vy * f;
        dx[j]! -= vx * f; dy[j]! -= vy * f;
      }
    }
    for (const [a, b] of edges) {
      const vx = xs[a]! - xs[b]!;
      const vy = ys[a]! - ys[b]!;
      const d = Math.sqrt(vx * vx + vy * vy) || 0.1;
      const f = (d * d) / k / d;
      dx[a]! -= vx * f; dy[a]! -= vy * f;
      dx[b]! += vx * f; dy[b]! += vy * f;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 0.1;
      const step = Math.min(d, temperature);
      xs[i]! += (dx[i]! / d) * step;
      ys[i]! += (dy[i]! / d) * step;
      xs[i] = Math.max(16, Math.min(W - 16, xs[i]!));
      ys[i] = Math.max(16, Math.min(H - 16, ys[i]!));
    }
    temperature *= 0.95;
  }

  return {
    nodes: nodes.map((node, i) => {
      const degree = node.imports + node.imported_by;
      return {
        id: node.id,
        x: xs[i]!,
        y: ys[i]!,
        r: Math.min(14, 3.5 + Math.sqrt(degree) * 1.6),
        color: node.external ? PKG_COLOR : (dirColors.get(node.dir) ?? OTHER_COLOR),
        dir: node.dir,
        external: node.external,
        degree,
      };
    }),
    dirColors,
  };
}

const shortName = (id: string) =>
  id.startsWith('pkg:') ? id.slice(4) : id.split('/').slice(-2).join('/');

export function CodeGraph({ graph }: { graph: ImportGraph }) {
  const { nodes, dirColors } = useMemo(() => layout(graph), [graph]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!m.has(e.from)) m.set(e.from, new Set());
      if (!m.has(e.to)) m.set(e.to, new Set());
      m.get(e.from)!.add(e.to);
      m.get(e.to)!.add(e.from);
    }
    return m;
  }, [graph]);

  const focus = selected ?? hovered;
  const focusSet = focus ? new Set([focus, ...(neighbors.get(focus) ?? [])]) : null;
  const focusNode = focus ? byId.get(focus) : null;

  return (
    <div>
      <div className="filter-bar" style={{ marginBottom: 6 }}>
        {[...dirColors.entries()].map(([dir, color]) => (
          <span key={dir} style={{ fontSize: 12 }}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
              background: color, marginRight: 4, verticalAlign: 'middle',
            }} />
            {dir === '.' ? '(root)' : `${dir}/`}
          </span>
        ))}
        <span style={{ fontSize: 12 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: PKG_COLOR, marginRight: 4, verticalAlign: 'middle',
            outline: '1px dashed var(--text-muted)',
          }} />
          external package
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', background: '#fcfcfb', border: '1px solid var(--border)', borderRadius: 8 }}
        onClick={() => setSelected(null)}
        role="img"
        aria-label="Import graph: files as nodes, imports as edges"
      >
        {graph.edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const inFocus = focusSet ? focus === e.from || focus === e.to : false;
          return (
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={inFocus ? '#404041' : '#c9d2ce'}
              strokeWidth={inFocus ? 1.5 : 0.7}
              opacity={focusSet && !inFocus ? 0.15 : 0.7}
            />
          );
        })}
        {nodes.map((node) => {
          const dimmed = focusSet !== null && !focusSet.has(node.id);
          return (
            <circle
              key={node.id}
              cx={node.x} cy={node.y} r={node.r}
              fill={node.color}
              opacity={dimmed ? 0.2 : 1}
              stroke={node.id === focus ? '#404041' : '#fcfcfb'}
              strokeWidth={node.id === focus ? 2 : 1}
              strokeDasharray={node.external ? '2 2' : undefined}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(node.id === selected ? null : node.id);
              }}
            />
          );
        })}
        {focusNode && (
          <text
            x={Math.min(focusNode.x + 10, W - 200)}
            y={Math.max(focusNode.y - 10, 14)}
            fontSize={12}
            fontWeight={600}
            fill="#404041"
            style={{ pointerEvents: 'none' }}
          >
            {shortName(focusNode.id)}
          </text>
        )}
      </svg>

      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        {focusNode ? (
          <>
            <strong>{focusNode.id}</strong> — {focusNode.degree} connection(s):{' '}
            {[...(neighbors.get(focusNode.id) ?? [])].slice(0, 8).map(shortName).join(', ')}
            {(neighbors.get(focusNode.id)?.size ?? 0) > 8 && ' …'}
            {selected && ' (click background to release)'}
          </>
        ) : (
          <>
            {graph.files_scanned} files · {graph.edges.length} imports — node size = connections;
            hover to trace, click to pin.
            {graph.files_skipped > 0 &&
              ` ${graph.files_skipped} file(s) beyond the scan cap were not included.`}
          </>
        )}
      </p>
    </div>
  );
}
