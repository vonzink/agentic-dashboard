import { Fragment, useState } from 'react';
import { useWorkflowGraphs } from '../api/hooks';
import type { StageKind, WorkflowGraph, WorkflowStage } from '../api/types';
import { ErrorState, Loading } from '../components/States';

const KIND_LABEL: Record<StageKind, string> = {
  human: 'Person',
  system: 'System',
  ai: 'AI model',
  check: 'Validation',
  gate: 'Approval gate',
};

function StageNode({ stage }: { stage: WorkflowStage }) {
  return (
    <div className={`flow-node ${stage.kind}${stage.optional ? ' optional' : ''}`}>
      <div className="k">
        {KIND_LABEL[stage.kind]}
        {stage.optional ? ' · optional' : ''}
      </div>
      <div className="t">{stage.label}</div>
      <div className="d">{stage.detail}</div>
    </div>
  );
}

function Pipeline({ stages }: { stages: WorkflowStage[] }) {
  return (
    <div className="flow">
      {stages.map((stage, i) => (
        <Fragment key={stage.id}>
          {i > 0 && <div className="flow-arrow">→</div>}
          <StageNode stage={stage} />
        </Fragment>
      ))}
    </div>
  );
}

function WorkflowDetail({ wf }: { wf: WorkflowGraph }) {
  const graphStages = wf.stages.filter((s) => s.source === 'langgraph');
  return (
    <>
      <div className="panel">
        <h2>{wf.workflow_name.replace(/_/g, ' ')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {wf.description}
        </p>
        <Pipeline stages={wf.stages} />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          The {graphStages.map((s) => s.label.toLowerCase()).join(' → ')} steps are the
          workflow's LangGraph — read directly from the compiled graph, so this diagram
          always matches what runs. The graph is tool-free by design: it can only draft.
        </p>
      </div>

      <div className="panel">
        <h2>Guardrails</h2>
        <ul className="tight">
          <li>
            Every output is created as <code>NEEDS_REVIEW</code> and requires human review —
            this cannot be disabled.
          </li>
          {wf.guardrails.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>Output shape ({wf.output_type})</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Read from the workflow's validation schema. Model output that doesn't match this
          shape fails the run.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Required</th>
            </tr>
          </thead>
          <tbody>
            {wf.output_fields.map((f) => (
              <tr key={f.name}>
                <td className="mono">{f.name}</td>
                <td>{f.type}</td>
                <td>{f.required ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function WorkflowsPage() {
  const { data, isLoading, error, refetch } = useWorkflowGraphs();
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const items = data?.items ?? [];
  const current = items.find((i) => i.workflow_name === selected) ?? items[0];

  return (
    <>
      <div className="panel">
        <h2>How every workflow runs</h2>
        <p className="muted" style={{ margin: 0 }}>
          These diagrams are generated from the live workflow definitions — the LangGraph
          topology and output schemas are read from the running code, not drawn by hand.
          Every pipeline follows the same compliance shape:{' '}
          <strong>AI drafts → validation → human review → only then any action</strong>.
        </p>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <div className="panel" style={{ width: 260, flexShrink: 0 }}>
          <h2>Workflows ({items.length})</h2>
          <div className="wf-list">
            {items.map((wf) => (
              <button
                key={wf.workflow_name}
                className={`wf-item${wf.workflow_name === current?.workflow_name ? ' active' : ''}`}
                onClick={() => setSelected(wf.workflow_name)}
              >
                {wf.workflow_name.replace(/_/g, ' ')}
                {!wf.is_active && <span className="badge red">disabled</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="grow">{current && <WorkflowDetail wf={current} />}</div>
      </div>
    </>
  );
}
