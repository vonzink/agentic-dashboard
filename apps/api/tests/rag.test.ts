import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { cosine, LocalHashEmbedder } from '../src/services/embeddings';
import { as, buildTestApp, createTask } from './helpers';

/** Builds a minimal, valid one-page PDF containing `text` (synthetic only). */
export function miniPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`,
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`,
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
    `5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
  ];
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += `${o}\n`;
  }
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function uploadText(app: Express, filename: string, body: string, type = 'guideline') {
  const res = await request(app)
    .post('/api/ai/documents/upload')
    .set(as.operator)
    .field('document_type', type)
    .attach('file', Buffer.from(body), { filename, contentType: 'text/plain' });
  expect(res.status).toBe(201);
  return res.body;
}

describe('LocalHashEmbedder', () => {
  const embedder = new LocalHashEmbedder();

  it('is deterministic and normalized', async () => {
    const [a, b] = await embedder.embed(['reserves required for jumbo loans', 'reserves required for jumbo loans']);
    expect(a).toEqual(b);
    expect(cosine(a!, b!)).toBeCloseTo(1, 6);
  });

  it('scores related text above unrelated text', async () => {
    const [query, related, unrelated] = await embedder.embed([
      'how many months of reserves are required',
      'Reserve requirements: two months PITI in reserves for second homes.',
      'The office picnic is scheduled for Saturday afternoon in the park.',
    ]);
    expect(cosine(query!, related!)).toBeGreaterThan(cosine(query!, unrelated!));
  });
});

describe('retrieval search endpoint', () => {
  it('ranks the on-topic document first', async () => {
    const { app } = await buildTestApp();
    await uploadText(app, 'voe-sop.txt', 'Verbal VOE: verbal verification of employment must be completed within 10 business days before closing.', 'sop');
    const reserves = await uploadText(app, 'reserves.txt', 'Reserve requirements: borrowers need two months of PITI reserves for second homes and six months for investment properties.');

    const res = await request(app)
      .get('/api/ai/search?q=how many months of reserves for investment properties')
      .set(as.viewer);
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('local-hash-v1');
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].document_id).toBe(reserves.id);
    expect(res.body.items[0].score).toBeGreaterThan(0);
  });

  it('requires a query of at least 2 chars', async () => {
    const { app } = await buildTestApp();
    await request(app).get('/api/ai/search?q=a').set(as.viewer).expect(400);
  });
});

describe('RAG-grounded workflow runs', () => {
  it('retrieve:true merges top chunks into sources with full provenance', async () => {
    const { app } = await buildTestApp();
    await uploadText(app, 'voe-sop.txt', 'Verbal VOE must be completed within 10 business days before closing.', 'sop');
    const reserves = await uploadText(app, 'reserves.txt', 'Reserve requirements: two months of PITI reserves are required for second homes.');

    const task = await createTask(app, as.operator, {
      title: 'Reserves question',
      task_type: 'sop_lookup',
    });
    await request(app)
      .post(`/api/ai/tasks/${task.id}/inputs`)
      .set(as.operator)
      .send({ input_type: 'question', content: 'How many months of PITI reserves are required for second homes?' });

    // No sources attached manually — retrieval supplies them.
    const run = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'sop_lookup_answer', options: { retrieve: true } });
    expect(run.status).toBe(201);

    const snapshot = (await request(app).get(`/api/ai/runs/${run.body.run.id}`).set(as.viewer)).body
      .input_snapshot_json;
    expect(snapshot.retrieval.hits.length).toBeGreaterThan(0);
    expect(snapshot.retrieval.hits[0].document_id).toBe(reserves.id);
    expect(snapshot.input.sources.some((s: { document_id: string }) => s.document_id === reserves.id)).toBe(true);

    const output = await request(app)
      .get(`/api/ai/outputs/${run.body.outputs[0].id}`)
      .set(as.viewer);
    expect(output.body.citations.length).toBeGreaterThan(0);
    expect(output.body.citations[0].document_id).toBe(reserves.id);
  });

  it('without retrieve, no library sources are pulled in', async () => {
    const { app } = await buildTestApp();
    await uploadText(app, 'reserves.txt', 'Reserve requirements: two months PITI.');
    const task = await createTask(app, as.operator, { title: 'Q', task_type: 'sop_lookup' });
    await request(app)
      .post(`/api/ai/tasks/${task.id}/inputs`)
      .set(as.operator)
      .send({ input_type: 'question', content: 'How many months of reserves?' });
    const run = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'sop_lookup_answer' });
    const snapshot = (await request(app).get(`/api/ai/runs/${run.body.run.id}`).set(as.viewer)).body
      .input_snapshot_json;
    expect(snapshot.input.sources).toHaveLength(0);
    expect(snapshot.retrieval).toBeNull();
  });
});

describe('PDF extraction', () => {
  it('extracts and chunks a text-based PDF at upload', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .field('document_type', 'guideline')
      .attach('file', miniPdf('Synthetic PDF guideline: escrows are required for LTV above 80 percent.'), {
        filename: 'escrows.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);
    expect(res.body.text_extraction_status).toBe('succeeded');
    expect(res.body.chunks.length).toBeGreaterThan(0);
    expect(res.body.chunks[0].content).toContain('escrows are required');
  });

  it('keeps corrupt/scanned PDFs pending and re-extract stays honest', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .attach('file', Buffer.from('%PDF-1.7 not really a pdf'), {
        filename: 'scan.pdf',
        contentType: 'application/pdf',
      });
    expect(res.body.text_extraction_status).toBe('pending');

    const retry = await request(app)
      .post(`/api/ai/documents/${res.body.id}/extract`)
      .set(as.operator);
    expect(retry.status).toBe(200);
    expect(retry.body.text_extraction_status).toBe('pending'); // never fabricated
    expect(retry.body.chunks).toHaveLength(0);
  });

  it('re-extract succeeds once the extractor can read the stored bytes', async () => {
    // Upload a valid PDF disguised so upload-time extraction is skipped
    // (octet-stream + .bin), then re-extract after "discovering" it's a PDF
    // is not possible without a type change — instead verify the success
    // path via a pending doc whose bytes ARE a readable PDF named .pdf:
    const { app, services } = await buildTestApp();
    const doc = await services.documents.create(
      { email: 'op@test.local', role: 'operator' },
      { filename: 'later.pdf', file_type: 'application/pdf', document_type: 'guideline', classification: 'internal', s3_bucket: null, s3_key: 'documents/manual/later.pdf', metadata_json: {} },
    );
    await services.storage.put('documents/manual/later.pdf', miniPdf('Deferred extraction works.'), 'application/pdf');
    const retry = await request(app).post(`/api/ai/documents/${doc.id}/extract`).set(as.operator);
    expect(retry.status).toBe(200);
    expect(retry.body.text_extraction_status).toBe('succeeded');
    expect(retry.body.chunks[0].content).toContain('Deferred extraction works');
  });

  it('blocks re-extract for already-extracted documents', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .attach('file', Buffer.from('plain text'), { filename: 'a.txt', contentType: 'text/plain' });
    await request(app)
      .post(`/api/ai/documents/${res.body.id}/extract`)
      .set(as.operator)
      .expect(409);
  });
});
