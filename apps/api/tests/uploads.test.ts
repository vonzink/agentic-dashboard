import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { MemoryStore } from '../src/repositories/memory';
import { chunkText } from '../src/services/extraction';
import { seedDefaults } from '../src/services/seed';
import type { BlobStorage, StoredBlob } from '../src/services/storage';
import { as } from './helpers';

/** Captures uploads in memory — no disk, no S3. */
class FakeStorage implements BlobStorage {
  readonly kind = 'local';
  puts: { key: string; size: number; contentType: string }[] = [];
  private blobs = new Map<string, Buffer>();
  async put(key: string, body: Buffer, contentType: string): Promise<StoredBlob> {
    this.puts.push({ key, size: body.length, contentType });
    this.blobs.set(key, body);
    return { bucket: null, key };
  }
  async get(key: string): Promise<Buffer | null> {
    return this.blobs.get(key) ?? null;
  }
}

async function uploadApp() {
  const store = new MemoryStore();
  await seedDefaults(store);
  const config = loadConfig({ env: 'local', authMode: 'dev', databaseUrl: null, modelProvider: 'mock' });
  const storage = new FakeStorage();
  const { app } = buildApp(store, config, { storage });
  return { app, store, storage };
}

describe('document upload', () => {
  it('stores a text file, extracts and chunks it, and audits the upload', async () => {
    const { app } = await uploadApp();
    const body = [
      '# Synthetic SOP — VOE',
      'Verbal VOE must be completed within 10 business days of closing.',
      'Self-employed borrowers require a third-party verification instead.',
    ].join('\n\n');

    const res = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .field('document_type', 'sop')
      .field('classification', 'internal')
      .attach('file', Buffer.from(body), { filename: 'TEST-SOP.md', contentType: 'text/markdown' });

    expect(res.status).toBe(201);
    expect(res.body.text_extraction_status).toBe('succeeded');
    expect(res.body.document_type).toBe('sop');
    expect(res.body.s3_key).toMatch(/^documents\/.+\/TEST-SOP\.md$/);
    expect(res.body.chunks.length).toBeGreaterThan(0);
    expect(res.body.chunks[0].content).toContain('Synthetic SOP');

    const chunks = await request(app)
      .get(`/api/ai/documents/${res.body.id}/chunks`)
      .set(as.viewer);
    expect(chunks.body.items.length).toBe(res.body.chunks.length);

    const audit = await request(app).get('/api/ai/audit?event_type=document.uploaded').set(as.viewer);
    expect(audit.body.total).toBe(1);
    expect(audit.body.items[0].event_payload_json.chunk_count).toBe(res.body.chunks.length);
  });

  it('stores binary files without faking extraction (pending for the OCR phase)', async () => {
    const { app } = await uploadApp();
    const res = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .attach('file', Buffer.from('%PDF-1.7 fake-binary'), {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.text_extraction_status).toBe('pending');
    expect(res.body.chunks).toHaveLength(0);
  });

  it('sanitizes hostile filenames', async () => {
    const { app } = await uploadApp();
    const res = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .attach('file', Buffer.from('hello'), {
        filename: '../../etc/passwd',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(201);
    expect(res.body.filename).toBe('passwd');
    expect(res.body.s3_key).not.toContain('..');
  });

  it('requires the operator role and a file', async () => {
    const { app } = await uploadApp();
    await request(app)
      .post('/api/ai/documents/upload')
      .set(as.viewer)
      .attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(403);
    await request(app).post('/api/ai/documents/upload').set(as.operator).expect(400);
  });

  it('uploaded chunks ground workflow runs and citations end to end', async () => {
    const { app } = await uploadApp();
    const doc = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .field('document_type', 'guideline')
      .attach('file', Buffer.from('Synthetic guideline: reserves of two months PITI are required.'), {
        filename: 'guideline.txt',
        contentType: 'text/plain',
      });

    const task = (
      await request(app)
        .post('/api/ai/tasks')
        .set(as.operator)
        .send({ title: 'Reserves question', task_type: 'sop_lookup' })
    ).body;
    await request(app)
      .post(`/api/ai/tasks/${task.id}/inputs`)
      .set(as.operator)
      .send({ input_type: 'question', content: 'How many months of reserves are required?' });
    await request(app)
      .post(`/api/ai/tasks/${task.id}/inputs`)
      .set(as.operator)
      .send({
        input_type: 'document_reference',
        content: doc.body.filename,
        source_document_id: doc.body.id,
      });

    const run = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'sop_lookup_answer' });
    expect(run.status).toBe(201);
    const output = await request(app)
      .get(`/api/ai/outputs/${run.body.outputs[0].id}`)
      .set(as.viewer);
    expect(output.body.citations.length).toBeGreaterThan(0);
    expect(output.body.citations[0].document_id).toBe(doc.body.id);
    expect(output.body.citations[0].chunk_id).toBeTruthy();
  });
});

describe('chunkText', () => {
  it('splits on paragraphs and respects the max length', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${'x'.repeat(300)}`).join('\n\n');
    const chunks = chunkText(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it('hard-splits oversized paragraphs', () => {
    const chunks = chunkText('word '.repeat(1000), 500);
    expect(chunks.length).toBeGreaterThan(5);
  });
});
