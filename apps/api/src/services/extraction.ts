/**
 * Text extraction + chunking for uploaded documents.
 *
 * Extractable today: text-native formats (txt/md/csv/json/html...) and
 * text-based PDFs (via pdf-parse/pdf.js). Scanned PDFs and images yield no
 * text and stay 'pending' for the Phase 3 OCR pipeline — we never pretend
 * to have read something we could not.
 */
import { PDFParse } from 'pdf-parse';

const TEXT_MIME = /^text\//;
const TEXT_LIKE = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/csv',
]);
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|html?)$/i;

/** Postgres text columns reject NUL bytes; strip them from extracted text. */
const NUL_BYTES = new RegExp(String.fromCharCode(0), 'g');

export function isTextExtractable(contentType: string, filename: string): boolean {
  return (
    TEXT_MIME.test(contentType) || TEXT_LIKE.has(contentType) || TEXT_EXTENSIONS.test(filename)
  );
}

export function isPdf(contentType: string, filename: string): boolean {
  return contentType === 'application/pdf' || /\.pdf$/i.test(filename);
}

export async function extractText(
  body: Buffer,
  contentType: string,
  filename: string,
): Promise<string | null> {
  if (isPdf(contentType, filename)) return extractPdfText(body);
  if (!isTextExtractable(contentType, filename)) return null;
  const text = body.toString('utf8').replace(NUL_BYTES, '').trim();
  return text.length ? text : null;
}

/** Text-based PDFs only; scanned/encrypted/corrupt PDFs return null. */
async function extractPdfText(body: Buffer): Promise<string | null> {
  const parser = new PDFParse({ data: new Uint8Array(body) });
  try {
    const result = await parser.getText();
    const text = result.text
      .replace(/^-- \d+ of \d+ --$/gm, '') // pdf-parse page separators
      .replace(NUL_BYTES, '')
      .trim();
    return text.length ? text : null;
  } catch {
    return null;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Splits text into citable chunks (~maxLen chars), preferring paragraph
 * boundaries so citations read naturally.
 */
export function chunkText(text: string, maxLen = 1500): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > maxLen) {
      flush();
      // Oversized paragraph: hard-split on sentence-ish boundaries.
      let rest = para;
      while (rest.length > maxLen) {
        const cut = rest.lastIndexOf('. ', maxLen);
        const at = cut > maxLen / 2 ? cut + 1 : maxLen;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      current = rest;
      continue;
    }
    if (current.length + para.length + 2 > maxLen) flush();
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();
  return chunks;
}
