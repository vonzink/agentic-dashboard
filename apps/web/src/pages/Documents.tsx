import { useState } from 'react';
import { useAddChunk, useCreateDocument, useDocument, useDocuments } from '../api/hooks';
import type { Classification, DocumentType } from '../api/types';
import { Badge } from '../components/Badge';
import { Pager } from '../components/Pager';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { fmtDate, titleCase } from '../lib/format';

const DOC_TYPES: DocumentType[] = [
  'sop', 'guideline', 'condition_sheet', 'paystub', 'bank_statement', 'tax_return',
  'credit_report', 'title_doc', 'insurance_doc', 'correspondence', 'manual_snippet', 'other',
];

function AddDocumentForm({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreateDocument();
  const [form, setForm] = useState({
    filename: '', document_type: 'manual_snippet' as DocumentType,
    classification: 'internal' as Classification, content: '', s3_bucket: '', s3_key: '',
  });
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.filename.trim()) return;
        create.mutate(
          {
            filename: form.filename.trim(),
            document_type: form.document_type,
            classification: form.classification,
            content: form.content.trim() || undefined,
            s3_bucket: form.s3_bucket.trim() || undefined,
            s3_key: form.s3_key.trim() || undefined,
          },
          {
            onSuccess: (doc) => {
              setForm({ ...form, filename: '', content: '', s3_bucket: '', s3_key: '' });
              onCreated(doc.id);
            },
          },
        );
      }}
    >
      <h2>Add source</h2>
      <div className="row">
        <label className="field grow">
          Name / label *
          <input type="text" value={form.filename}
            onChange={(e) => setForm({ ...form, filename: e.target.value })} />
        </label>
        <label className="field">
          Type
          <select value={form.document_type}
            onChange={(e) => setForm({ ...form, document_type: e.target.value as DocumentType })}>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        <label className="field">
          Classification
          <select value={form.classification}
            onChange={(e) => setForm({ ...form, classification: e.target.value as Classification })}>
            {(['public', 'internal', 'borrower_pii'] as const).map((c) => (
              <option key={c} value={c}>{titleCase(c)}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Snippet text (becomes the first chunk; uploads come in Phase 2)
        <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      </label>
      <div className="row">
        <label className="field grow">
          S3 bucket (optional metadata)
          <input type="text" value={form.s3_bucket} onChange={(e) => setForm({ ...form, s3_bucket: e.target.value })} />
        </label>
        <label className="field grow">
          S3 key
          <input type="text" value={form.s3_key} onChange={(e) => setForm({ ...form, s3_key: e.target.value })} />
        </label>
      </div>
      {create.isError && <ErrorState error={create.error} />}
      <button className="btn primary" disabled={create.isPending || !form.filename.trim()}>
        {create.isPending ? 'Saving…' : 'Add source'}
      </button>
    </form>
  );
}

function DocumentDetailPanel({ id }: { id: string }) {
  const detail = useDocument(id);
  const addChunk = useAddChunk(id);
  const [chunkText, setChunkText] = useState('');
  const [section, setSection] = useState('');

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} />;
  const doc = detail.data;

  return (
    <div className="panel">
      <h2>{doc.filename}</h2>
      <p className="muted">
        <Badge value={doc.classification} /> <Badge value={doc.text_extraction_status} />{' '}
        {titleCase(doc.document_type)} · added by {doc.created_by} {fmtDate(doc.created_at)}
        {doc.s3_key && <> · <span className="mono">s3://{doc.s3_bucket}/{doc.s3_key}</span></>}
      </p>
      <h3>Chunks ({doc.chunks.length})</h3>
      {doc.chunks.map((c) => (
        <div className="citation" key={c.id}>
          <span className="label">
            #{c.chunk_index}{c.section_label ? ` · ${c.section_label}` : ''}{c.page_number ? ` · p.${c.page_number}` : ''}
          </span>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!chunkText.trim()) return;
          addChunk.mutate(
            { content: chunkText.trim(), section_label: section.trim() || undefined },
            { onSuccess: () => { setChunkText(''); setSection(''); } },
          );
        }}
      >
        <label className="field">
          Add chunk
          <textarea value={chunkText} style={{ minHeight: 60 }} onChange={(e) => setChunkText(e.target.value)} />
        </label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">
            Section label (optional)
            <input type="text" value={section} onChange={(e) => setSection(e.target.value)} />
          </label>
          <button className="btn sm" disabled={addChunk.isPending || !chunkText.trim()}>Add chunk</button>
        </div>
        {addChunk.isError && <ErrorState error={addChunk.error} />}
      </form>
    </div>
  );
}

export function DocumentsPage() {
  const [page, setPage] = useState(1);
  const [docType, setDocType] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const docs = useDocuments({ document_type: docType, page, pageSize: 20 });

  return (
    <div>
      <AddDocumentForm onCreated={setSelected} />

      <div className="panel">
        <h2>Source documents</h2>
        <div className="filter-bar">
          <select value={docType} onChange={(e) => { setDocType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </div>
        {docs.isPending && <Loading />}
        {docs.isError && <ErrorState error={docs.error} onRetry={() => docs.refetch()} />}
        {docs.data && docs.data.items.length === 0 && (
          <EmptyState message="No source documents yet. Add SOP/guideline snippets above so AI answers can cite them." />
        )}
        {docs.data && docs.data.items.length > 0 && (
          <>
            <table className="data">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Classification</th><th>Extraction</th><th>Added</th></tr>
              </thead>
              <tbody>
                {docs.data.items.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => setSelected(d.id)}
                    style={selected === d.id ? { background: '#eef5e3' } : undefined}>
                    <td><strong>{d.filename}</strong></td>
                    <td>{titleCase(d.document_type)}</td>
                    <td><Badge value={d.classification} /></td>
                    <td><Badge value={d.text_extraction_status} /></td>
                    <td>{fmtDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={docs.data.page} pageSize={docs.data.pageSize} total={docs.data.total} onPage={setPage} />
          </>
        )}
      </div>

      {selected && <DocumentDetailPanel id={selected} />}
    </div>
  );
}
