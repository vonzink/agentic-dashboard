import { z } from 'zod';
import type { WorkflowConfig } from '../types/domain';
import type { ModelProvider } from './providers';
import { WORKFLOWS } from './registry';
import { buildGraph } from './runner';
import type { WorkflowDefinition } from './types';

/**
 * Introspects the implemented workflows for the Workflows visualization
 * page. Two parts are extracted from the live code so the diagrams cannot
 * go stale:
 *   - the LangGraph node order, read from the compiled graph itself
 *   - the output fields, read from the workflow's zod schema
 * The surrounding service-layer stages (input assembly, retrieval, the
 * review gate) mirror RunService.run / ApprovalService and are described
 * here as static metadata.
 */

export type StageKind = 'human' | 'system' | 'ai' | 'check' | 'gate';

export interface StageDescriptor {
  id: string;
  label: string;
  detail: string;
  kind: StageKind;
  /** Stage runs only when requested/configured (e.g. RAG retrieval). */
  optional?: boolean;
  /** Where the stage lives: LangGraph node vs surrounding service code. */
  source: 'langgraph' | 'service';
}

export interface OutputFieldDescriptor {
  name: string;
  type: string;
  required: boolean;
}

export interface WorkflowGraphDescriptor {
  workflow_name: string;
  task_type: string;
  description: string;
  output_type: string;
  requires_approval: boolean;
  is_active: boolean;
  stages: StageDescriptor[];
  guardrails: string[];
  output_fields: OutputFieldDescriptor[];
}

/** Never executes — exists only so the graph can be compiled and read. */
const introspectionProvider: ModelProvider = {
  name: 'introspection',
  model: 'none',
  complete: async () => {
    throw new Error('Introspection provider cannot execute model calls');
  },
};

/** Labels/details for known LangGraph nodes; unknown nodes still render. */
const GRAPH_NODE_META: Record<string, Omit<StageDescriptor, 'id' | 'source'>> = {
  generate: {
    label: 'Model call',
    detail:
      'The only step that talks to the LLM. Provider, model, and prompt version are recorded on the run.',
    kind: 'ai',
  },
  parse_validate: {
    label: 'Parse & validate',
    detail:
      'Output must be strict JSON matching the workflow schema. Failures fail the run — malformed output never reaches a reviewer.',
    kind: 'check',
  },
  assess: {
    label: 'Guardrail checks',
    detail:
      'Workflow-specific checks append warnings and can downgrade the confidence label.',
    kind: 'check',
  },
};

/** Walks the compiled graph from __start__ to recover linear node order. */
function langgraphNodeOrder(def: WorkflowDefinition): string[] {
  const drawable = buildGraph(def, introspectionProvider).getGraph();
  const next = new Map(drawable.edges.map((e) => [e.source, e.target]));
  const order: string[] = [];
  const seen = new Set<string>();
  let node = next.get('__start__');
  while (node && node !== '__end__' && !seen.has(node)) {
    seen.add(node);
    order.push(node);
    node = next.get(node);
  }
  return order;
}

function langgraphStages(def: WorkflowDefinition): StageDescriptor[] {
  return langgraphNodeOrder(def).map((id) => {
    const meta = GRAPH_NODE_META[id] ?? {
      label: id.replace(/_/g, ' '),
      detail: 'LangGraph node',
      kind: 'system' as const,
    };
    return { id, ...meta, source: 'langgraph' as const };
  });
}

/** Stages before and after the graph, mirroring RunService/ApprovalService. */
const PRE_GRAPH_STAGES: StageDescriptor[] = [
  {
    id: 'task_input',
    label: 'Task created',
    detail:
      'An operator describes the request and attaches context and source documents. Nothing runs without a person starting it.',
    kind: 'human',
    source: 'service',
  },
  {
    id: 'assemble_input',
    label: 'Input assembled',
    detail:
      'Task inputs and selected document chunks are combined into the workflow input and snapshotted onto the run for audit.',
    kind: 'system',
    source: 'service',
  },
  {
    id: 'retrieve',
    label: 'Retrieve sources',
    detail:
      'Optional RAG step: the top 5 matching chunks are pulled from the document library — scoped to this company only.',
    kind: 'system',
    optional: true,
    source: 'service',
  },
  {
    id: 'render_prompt',
    label: 'Render prompt',
    detail:
      'The active versioned prompt template is rendered. The exact version is recorded on the run.',
    kind: 'system',
    source: 'service',
  },
];

const POST_GRAPH_STAGES: StageDescriptor[] = [
  {
    id: 'persist_draft',
    label: 'Draft saved — needs review',
    detail:
      'Output, citations, token counts, cost, and audit events are written in one transaction. Review status: NEEDS_REVIEW.',
    kind: 'system',
    source: 'service',
  },
  {
    id: 'human_review',
    label: 'Human review gate',
    detail:
      'A reviewer approves, rejects, or requests changes — and can edit the final content. Nothing ships without this step.',
    kind: 'gate',
    source: 'service',
  },
  {
    id: 'action',
    label: 'Action (after approval only)',
    detail:
      'Integration actions are blocked by the service layer AND a database trigger until the output is approved.',
    kind: 'gate',
    optional: true,
    source: 'service',
  },
];

/** Renders a JSON-schema property as a short human-readable type. */
function fieldType(prop: Record<string, unknown>): string {
  if (prop.const !== undefined) return `always ${JSON.stringify(prop.const)}`;
  if (Array.isArray(prop.enum)) return prop.enum.join(' | ');
  if (prop.type === 'array') {
    const items = (prop.items ?? {}) as Record<string, unknown>;
    if (items.type === 'object') {
      const keys = Object.keys((items.properties ?? {}) as object);
      return `list of { ${keys.join(', ')} }`;
    }
    return `list of ${String(items.type ?? 'any')}`;
  }
  return String(prop.type ?? 'unknown');
}

function outputFields(def: WorkflowDefinition): OutputFieldDescriptor[] {
  const jsonSchema = z.toJSONSchema(def.outputSchema) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const required = new Set(jsonSchema.required ?? []);
  return Object.entries(jsonSchema.properties ?? {}).map(([name, prop]) => ({
    name,
    type: fieldType(prop),
    required: required.has(name),
  }));
}

export function describeWorkflows(configs: WorkflowConfig[]): WorkflowGraphDescriptor[] {
  return Object.values(WORKFLOWS).map((def) => {
    const cfg = configs.find((c) => c.workflow_name === def.name);
    return {
      workflow_name: def.name,
      task_type: def.taskType,
      description: def.description,
      output_type: def.outputType,
      requires_approval: cfg?.requires_approval ?? true,
      is_active: cfg?.is_active ?? true,
      stages: [...PRE_GRAPH_STAGES, ...langgraphStages(def), ...POST_GRAPH_STAGES],
      guardrails: def.guardrails,
      output_fields: outputFields(def),
    };
  });
}
