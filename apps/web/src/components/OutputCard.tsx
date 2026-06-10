import type { AiOutput, Citation } from '../api/types';
import { fmtDate } from '../lib/format';
import { Badge } from './Badge';

/** Mandatory compliance banners — docs/AI_COMPLIANCE_GUARDRAILS.md §UI. */
export function ComplianceBanners({ output }: { output: AiOutput }) {
  const actionTaken =
    output.review_status === 'ACTION_SENT' || output.review_status === 'ACTION_COMPLETED';
  const weak =
    output.confidence_label === 'LOW' ||
    !(output.structured_json && Array.isArray(output.structured_json['citations']) &&
      (output.structured_json['citations'] as unknown[]).length > 0);
  return (
    <div>
      <div className="banner warn">⚠ AI draft — human review required</div>
      {weak && (
        <div className="banner warn">
          Do not rely on this without verifying source documents
        </div>
      )}
      {!actionTaken && <div className="banner info">No external action has been taken</div>}
    </div>
  );
}

function List({ title, items }: { title: string; items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul className="tight">
        {items.map((it, i) => (
          <li key={i}>{String(it)}</li>
        ))}
      </ul>
    </>
  );
}

function Citations({ citations }: { citations: Citation[] | undefined }) {
  if (!citations?.length) return null;
  return (
    <>
      <h3>Citations</h3>
      {citations.map((c, i) => (
        <div className="citation" key={c.id ?? i}>
          <span className="label">
            [{i + 1}] {c.source_label}
            {c.page_number ? `, p.${c.page_number}` : ''}
          </span>
          <div>{c.citation_text}</div>
        </div>
      ))}
    </>
  );
}

/** Renders the structured workflow output by shape. */
function StructuredBody({ output }: { output: AiOutput }) {
  const s = (output.structured_json ?? {}) as Record<string, unknown>;
  const summary = typeof s.summary === 'string' ? s.summary : null;

  return (
    <div>
      {summary && <p>{summary}</p>}
      <List title="Missing items" items={s.missing_items} />
      <List title="Checklist" items={s.checklist} />
      {Array.isArray(s.documents) && s.documents.length > 0 && (
        <>
          <h3>Documents needed</h3>
          <table className="data">
            <thead>
              <tr><th>Document</th><th>Why</th><th>When</th><th></th></tr>
            </thead>
            <tbody>
              {(s.documents as Record<string, unknown>[]).map((d, i) => (
                <tr key={i}>
                  <td>{String(d.name ?? '')}</td>
                  <td>{String(d.reason ?? '')}</td>
                  <td>{String(d.when_needed ?? '')}</td>
                  <td>{d.required ? <span className="badge amber">required</span> : <span className="muted">optional</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <List title="Recommended next steps" items={s.recommended_next_steps} />
      <List title="Caveats" items={s.caveats} />

      {typeof s.email_subject === 'string' && (
        <>
          <h3>Email draft</h3>
          <div className="draft-panel">
            <strong>Subject: {s.email_subject}</strong>
            {'\n\n'}
            {String(s.email_body ?? '')}
          </div>
        </>
      )}
      {typeof s.draft_response === 'string' && (
        <>
          <h3>Draft response</h3>
          <div className="draft-panel">{s.draft_response}</div>
        </>
      )}
      {typeof s.answer === 'string' && (
        <>
          <h3>Answer</h3>
          <div className="draft-panel">{s.answer}</div>
        </>
      )}
      {Array.isArray(s.warnings) && (s.warnings as string[]).length > 0 && (
        <>
          <h3>Warnings</h3>
          {(s.warnings as string[]).map((w, i) => (
            <div className="banner warn" key={i}>
              {w}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function copyFinalText(output: AiOutput, finalContent?: string | null) {
  const text = finalContent ?? output.content;
  void navigator.clipboard.writeText(text);
}

/**
 * The shared AI-output renderer used on the task detail page and the
 * approval center. `actions` lets callers append decision controls.
 */
export function OutputCard({
  output,
  citations,
  actions,
}: {
  output: AiOutput;
  citations?: Citation[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="output-card">
      <div className="head">
        <Badge value={output.review_status} />
        <Badge value={output.confidence_label} prefix="Confidence" />
        <span className="muted">{fmtDate(output.created_at)}</span>
      </div>
      <ComplianceBanners output={output} />
      <StructuredBody output={output} />
      <Citations citations={citations ?? output.citations} />
      {actions && <div style={{ marginTop: 12 }}>{actions}</div>}
    </div>
  );
}
