import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config';

export interface StoredBlob {
  /** null for local-disk storage. */
  bucket: string | null;
  key: string;
}

/** Where uploaded document bytes live. Postgres only ever holds metadata. */
export interface BlobStorage {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<StoredBlob>;
}

/** Dev fallback: writes under a local directory (gitignored). */
export class LocalDiskStorage implements BlobStorage {
  readonly kind = 'local';
  constructor(private baseDir: string) {}

  async put(key: string, body: Buffer): Promise<StoredBlob> {
    const safe = normalize(key).replace(/^(\.\.[/\\])+/, '');
    const path = join(this.baseDir, safe);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { bucket: null, key: safe };
  }
}

/** Production: private S3 bucket, SSE at rest. Credentials come from the
 * standard AWS chain (task role in ECS) — never from this codebase. */
export class S3Storage implements BlobStorage {
  readonly kind = 's3';
  constructor(
    private bucket: string,
    private client: S3Client = new S3Client({}),
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<StoredBlob> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { bucket: this.bucket, key };
  }
}

export function createStorage(config: AppConfig): BlobStorage {
  return config.s3Bucket
    ? new S3Storage(config.s3Bucket)
    : new LocalDiskStorage(config.uploadDir);
}
