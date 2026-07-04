import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildImportGraph, extractImports, pickSourceFiles, resolveImport } from '../src/services/importScan';
import { as } from './helpers';
import { buildProjectApp, createProject } from './projectHarness';

describe('import scanner (pure)', () => {
  it('extracts JS/TS and Python import specifiers', () => {
    expect(
      extractImports(
        'src/a.ts',
        `import x from './b';\nimport { y } from '../lib/y';\nexport { z } from './z';\nconst q = require('pg');\nconst lazy = await import('./lazy');`,
      ),
    ).toEqual(['./b', '../lib/y', './z', 'pg', './lazy']);
    expect(
      extractImports('app/main.py', `import os\nfrom flask import Flask\nfrom .models import User`),
    ).toEqual(['os', 'flask', '.models']);
  });

  it('resolves relative imports against the file tree', () => {
    const files = new Set(['src/a.ts', 'src/b.ts', 'src/lib/y/index.ts', 'app/models.py', 'app/main.py']);
    expect(resolveImport('src/a.ts', './b', files)).toBe('src/b.ts');
    expect(resolveImport('src/a.ts', './lib/y', files)).toBe('src/lib/y/index.ts');
    expect(resolveImport('src/a.ts', 'react', files)).toBe('pkg:react');
    expect(resolveImport('src/a.ts', '@tanstack/react-query', files)).toBe('pkg:@tanstack/react-query');
    expect(resolveImport('app/main.py', '.models', files)).toBe('app/models.py');
    expect(resolveImport('src/a.ts', './missing', files)).toBeNull();
  });

  it('builds a graph with degrees; single-use packages are dropped', () => {
    const graph = buildImportGraph(
      {
        'src/a.ts': `import b from './b'; import React from 'react';`,
        'src/b.ts': `import React from 'react'; import lonely from 'left-pad';`,
      },
      3,
    );
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'pkg:react']));
    expect(ids).not.toContain('pkg:left-pad'); // imported once → noise, dropped
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'src/a.ts', to: 'src/b.ts' },
        { from: 'src/a.ts', to: 'pkg:react' },
      ]),
    );
    const b = graph.nodes.find((n) => n.id === 'src/b.ts')!;
    expect(b.imported_by).toBe(1);
    expect(graph.files_skipped).toBe(3);
  });

  it('caps scanned files and excludes vendored/build paths', () => {
    const entries = [
      { path: 'src/a.ts', type: 'blob' as const },
      { path: 'node_modules/x/i.js', type: 'blob' as const },
      { path: 'dist/out.js', type: 'blob' as const },
      { path: 'src/types.d.ts', type: 'blob' as const },
      { path: 'README.md', type: 'blob' as const },
    ];
    const { files, skipped } = pickSourceFiles(entries, 10);
    expect(files).toEqual(['src/a.ts']);
    expect(skipped).toBe(0);
  });
});

describe('POST /projects/:id/scan-imports', () => {
  it('stores the deterministic import graph, audited', async () => {
    const { app, github } = await buildProjectApp();
    github.files = {
      'web/src/App.tsx': `import { api } from './api'; import React from 'react';`,
      'web/src/api.ts': `import React from 'react';`,
      'server/index.ts': `import express from 'express';`,
    };
    github.tree.entries.push(
      { path: 'web/src/api.ts', type: 'blob' },
      { path: 'server/index.ts', type: 'blob' },
    );

    const { body: project } = await createProject(app);
    const res = await request(app)
      .post(`/api/ai/projects/${project.id}/scan-imports`)
      .set(as.operator)
      .expect(200);

    const graph = res.body.import_graph_json;
    expect(graph.files_scanned).toBeGreaterThan(0);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'web/src/App.tsx', to: 'web/src/api.ts' },
        { from: 'web/src/App.tsx', to: 'pkg:react' },
      ]),
    );
    const dirs = new Set(graph.nodes.map((n: { dir: string }) => n.dir));
    expect(dirs).toContain('web');
    expect(dirs).toContain('pkg');
  });
});
