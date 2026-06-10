/**
 * Text extraction + chunking for uploaded documents.
 *
 * MVP scope: text-native formats only (txt/md/csv/json/html...). Binary
 * formats (PDF, images, Office docs) are stored and marked 'pending' for
 * the Phase 3 OCR/extraction pipeline — we never pretend to have read
 * something we could not.
 */

const TEXT_MIME = /^text\//;
const TEXT_LIKE = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/csv',
]);
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|html?)$/i;

export function isTextExtractable(contentType: string, filename: string): boolean {
  return (
    TEXT_MIME.test(contentType) || TEXT_LIKE.has(contentType) || TEXT_EXTENSIONS.test(filename)
  );
}

export function extractText(
  body: Buffer,
  contentType: string,
  filename: string,
): string | null {
  if (!isTextExtractable(contentType, filename)) return null;
  const text = body.toString('utf8').replace(/\u0000/g, '').trim();
  return text.length ? text : null;
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
