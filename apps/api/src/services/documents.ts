import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { ApiError } from '../middleware/error';
import type { Page, Store } from '../repositories/interfaces';
import type { AuthUser, SourceChunk, SourceDocument } from '../types/domain';
import type { Classification, DocumentType } from '../types/statuses';
import type { AuditService } from './audit';
import { chunkText, extractText } from './extraction';
import type { BlobStorage } from './storage';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export class DocumentService {
  constructor(
    private store: Store,
    private audit: AuditService,
    private storage: BlobStorage,
  ) {}

  /**
   * Stores an uploaded file (S3 in AWS, local disk in dev), extracts text
   * from text-native formats and chunks it for citation. Binary formats
   * (PDF, images, Office) are stored with extraction_status='pending' for
   * the Phase 3 OCR pipeline — never silently "extracted".
   */
  async upload(
    actor: AuthUser,
    file: UploadedFile,
    opts: { document_type: DocumentType; classification: Classification },
  ): Promise<SourceDocument & { chunks: SourceChunk[] }> {
    const filename = basename(file.originalname).replace(/[^\w.\- ()]/g, '_') || 'upload';
    const key = `documents/${randomUUID()}/${filename}`;
    const stored = await this.storage.put(key, file.buffer, file.mimetype);

    const text = extractText(file.buffer, file.mimetype, filename);
    const doc = await this.store.documents.create({
      filename,
      file_type: file.mimetype || null,
      s3_bucket: stored.bucket,
      s3_key: stored.key,
      text_extraction_status: text ? 'succeeded' : 'pending',
      document_type: opts.document_type,
      classification: opts.classification,
      created_by: actor.email,
      metadata_json: { storage: this.storage.kind, size_bytes: file.size },
    });

    const chunks: SourceChunk[] = [];
    if (text) {
      for (const [index, content] of chunkText(text).entries()) {
        chunks.push(
          await this.store.chunks.create({
            document_id: doc.id,
            chunk_index: index,
            content,
            page_number: null,
            section_label: null,
            embedding_id: null,
          }),
        );
      }
    }

    await this.audit.record('document.uploaded', {
      actor: actor.email,
      payload: {
        document_id: doc.id,
        filename,
        content_type: file.mimetype,
        size_bytes: file.size,
        storage: this.storage.kind,
        classification: doc.classification,
        extraction: doc.text_extraction_status,
        chunk_count: chunks.length,
      },
    });
    return { ...doc, chunks };
  }

  /**
   * Creates a document record. MVP: metadata + optional manual snippet text
   * (stored as chunk 0). Actual S3 upload arrives in Phase 2 — s3_bucket/key
   * are accepted as metadata for documents that already live in S3.
   */
  async create(
    actor: AuthUser,
    body: {
      filename: string;
      file_type?: string | null;
      document_type: DocumentType;
      classification: Classification;
      s3_bucket?: string | null;
      s3_key?: string | null;
      content?: string | null;
      metadata_json: Record<string, unknown>;
    },
  ): Promise<SourceDocument> {
    const isManual = !!body.content;
    const doc = await this.store.documents.create({
      filename: body.filename,
      file_type: body.file_type ?? (isManual ? 'text/plain' : null),
      s3_bucket: body.s3_bucket ?? null,
      s3_key: body.s3_key ?? null,
      text_extraction_status: isManual ? 'manual' : body.s3_key ? 'pending' : 'not_applicable',
      document_type: body.document_type,
      classification: body.classification,
      created_by: actor.email,
      metadata_json: body.metadata_json,
    });
    if (body.content) {
      await this.store.chunks.create({
        document_id: doc.id,
        chunk_index: 0,
        content: body.content,
        page_number: null,
        section_label: null,
        embedding_id: null,
      });
    }
    await this.audit.record('document.created', {
      actor: actor.email,
      payload: {
        document_id: doc.id,
        filename: doc.filename,
        document_type: doc.document_type,
        classification: doc.classification,
        has_manual_snippet: isManual,
      },
    });
    return doc;
  }

  async get(id: string): Promise<SourceDocument> {
    const doc = await this.store.documents.get(id);
    if (!doc) throw ApiError.notFound('Document');
    return doc;
  }

  async detail(id: string) {
    const doc = await this.get(id);
    const chunks = await this.store.chunks.listByDocument(id);
    return { ...doc, chunks };
  }

  list(filter: Page & { document_type?: string }) {
    return this.store.documents.list(filter);
  }

  async addChunk(
    actor: AuthUser,
    documentId: string,
    body: { content: string; page_number?: number | null; section_label?: string | null },
  ): Promise<SourceChunk> {
    await this.get(documentId);
    const chunk = await this.store.chunks.create({
      document_id: documentId,
      chunk_index: await this.store.chunks.nextIndex(documentId),
      content: body.content,
      page_number: body.page_number ?? null,
      section_label: body.section_label ?? null,
      embedding_id: null,
    });
    await this.audit.record('chunk.created', {
      actor: actor.email,
      payload: { document_id: documentId, chunk_id: chunk.id, chunk_index: chunk.chunk_index },
    });
    return chunk;
  }

  async listChunks(documentId: string): Promise<SourceChunk[]> {
    await this.get(documentId);
    return this.store.chunks.listByDocument(documentId);
  }
}
