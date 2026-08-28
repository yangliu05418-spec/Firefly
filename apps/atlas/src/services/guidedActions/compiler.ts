import type { GuidedAction, GuidedToolCall } from './types';
import {
  createDefaultToolChoreography,
  getGuidedToolChoreography,
  normalizeBatchToolCalls,
  stripExecutionActions,
} from './choreography/toolChoreographies';
import type { GuidedToolChoreographyContext } from './choreography/types';

export type GuidedBatchCompileMode = 'singleExecution' | 'inlineExecutions';

export interface GuidedToolCompileOptions {
  batchMode?: GuidedBatchCompileMode;
  includeValidation?: boolean;
}

export interface GuidedToolCompileDiagnostics {
  actionCount: number;
  executionActionCount: number;
  flattenedBatchActions: number;
  supported: boolean;
  tool: string;
  warnings: string[];
}

export interface GuidedCompiledToolCall {
  actions: GuidedAction[];
  diagnostics: GuidedToolCompileDiagnostics;
  toolCall: GuidedToolCall;
}

export interface GuidedCompiledToolBatch {
  actions: GuidedAction[];
  calls: GuidedCompiledToolCall[];
  diagnostics: {
    actionCount: number;
    executionActionCount: number;
    flattenedBatchActions: number;
    unsupportedTools: string[];
    warnings: string[];
  };
}

interface NormalizedCompileOptions {
  batchMode: GuidedBatchCompileMode;
  includeValidation: boolean;
}

const DEFAULT_OPTIONS: NormalizedCompileOptions = {
  batchMode: 'singleExecution',
  includeValidation: true,
};

const MAX_BATCH_PREVIEW_DEPTH = 2;

export function compileGuidedToolCall(
  toolCall: GuidedToolCall,
  options?: GuidedToolCompileOptions,
): GuidedCompiledToolCall {
  return compileGuidedToolCallInternal(toolCall, normalizeOptions(options), 0);
}

export function compileGuidedToolCalls(
  toolCalls: GuidedToolCall[],
  options?: GuidedToolCompileOptions,
): GuidedCompiledToolBatch {
  const normalizedOptions = normalizeOptions(options);
  const calls = toolCalls.map((toolCall) => compileGuidedToolCallInternal(toolCall, normalizedOptions, 0));
  const actions = calls.flatMap((call) => call.actions);

  return {
    actions,
    calls,
    diagnostics: {
      actionCount: actions.length,
      executionActionCount: countExecutionActions(actions),
      flattenedBatchActions: sumBy(calls, (call) => call.diagnostics.flattenedBatchActions),
      unsupportedTools: calls
        .filter((call) => !call.diagnostics.supported)
        .map((call) => call.toolCall.tool),
      warnings: calls.flatMap((call) => call.diagnostics.warnings),
    },
  };
}

export function compileGuidedToolActions(
  toolCalls: GuidedToolCall[],
  options?: GuidedToolCompileOptions,
): GuidedAction[] {
  return compileGuidedToolCalls(toolCalls, options).actions;
}

function compileGuidedToolCallInternal(
  toolCall: GuidedToolCall,
  options: NormalizedCompileOptions,
  batchDepth: number,
): GuidedCompiledToolCall {
  if (toolCall.tool === 'executeBatch') {
    return compileExecuteBatchToolCall(toolCall, options, batchDepth);
  }

  const choreography = getGuidedToolChoreography(toolCall.tool);
  const supported = Boolean(choreography);
  const context: GuidedToolChoreographyContext = {
    batchDepth,
    includeValidation: options.includeValidation,
  };
  const actions = choreography
    ? choreography(toolCall, context)
    : createDefaultToolChoreography(toolCall, context);

  return createCompiledToolCall(toolCall, actions, {
    flattenedBatchActions: 0,
    supported,
    warnings: [],
  });
}

function compileExecuteBatchToolCall(
  toolCall: GuidedToolCall,
  options: NormalizedCompileOptions,
  batchDepth: number,
): GuidedCompiledToolCall {
  const nestedToolCalls = normalizeBatchToolCalls(toolCall.args.actions);
  const warnings: string[] = [];

  if (nestedToolCalls.length === 0) {
    warnings.push('executeBatch has no visible nested actions');
  }

  if (options.batchMode === 'inlineExecutions') {
    const inline = nestedToolCalls.map((nestedToolCall) => (
      compileGuidedToolCallInternal(nestedToolCall, options, batchDepth + 1)
    ));
    const actions = inline.flatMap((compiled) => compiled.actions);
    return createCompiledToolCall(toolCall, actions, {
      flattenedBatchActions: nestedToolCalls.length,
      supported: true,
      warnings: [
        ...warnings,
        ...inline.flatMap((compiled) => compiled.diagnostics.warnings),
      ],
    });
  }

  if (batchDepth >= MAX_BATCH_PREVIEW_DEPTH) {
    warnings.push('Nested executeBatch preview depth limit reached');
    const actions = createDefaultToolChoreography(toolCall, {
      batchDepth,
      includeValidation: options.includeValidation,
    });
    return createCompiledToolCall(toolCall, actions, {
      flattenedBatchActions: nestedToolCalls.length,
      supported: true,
      warnings,
    });
  }

  const previewActions = nestedToolCalls.flatMap((nestedToolCall) => {
    const compiled = compileGuidedToolCallInternal(nestedToolCall, {
      ...options,
      includeValidation: false,
    }, batchDepth + 1);
    warnings.push(...compiled.diagnostics.warnings);
    return stripExecutionActions(compiled.actions);
  });

  const actions: GuidedAction[] = [
    {
      type: 'callout',
      title: 'Execute batch',
      body: `${nestedToolCalls.length} guided substep${nestedToolCalls.length === 1 ? '' : 's'}`,
      family: 'semantic',
      label: 'Preview batch',
    },
    ...previewActions,
    {
      type: 'executeTool',
      tool: toolCall.tool,
      args: toolCall.args,
      family: 'semantic',
      label: 'Execute batch',
    },
  ];

  if (options.includeValidation) {
    actions.push({
      type: 'confirmState',
      check: {
        kind: 'custom',
        id: 'guided-tool:executeBatch',
        label: 'Confirm batch execution',
        data: {
          actionCount: nestedToolCalls.length,
          tool: toolCall.tool,
        },
      },
      family: 'semantic',
      label: 'Confirm batch',
    });
  }

  return createCompiledToolCall(toolCall, actions, {
    flattenedBatchActions: nestedToolCalls.length,
    supported: true,
    warnings,
  });
}

function createCompiledToolCall(
  toolCall: GuidedToolCall,
  actions: GuidedAction[],
  metadata: Pick<GuidedToolCompileDiagnostics, 'flattenedBatchActions' | 'supported' | 'warnings'>,
): GuidedCompiledToolCall {
  return {
    toolCall,
    actions,
    diagnostics: {
      ...metadata,
      actionCount: actions.length,
      executionActionCount: countExecutionActions(actions),
      tool: toolCall.tool,
    },
  };
}

function normalizeOptions(options?: GuidedToolCompileOptions): NormalizedCompileOptions {
  return {
    batchMode: options?.batchMode ?? DEFAULT_OPTIONS.batchMode,
    includeValidation: options?.includeValidation ?? DEFAULT_OPTIONS.includeValidation,
  };
}

function countExecutionActions(actions: GuidedAction[]): number {
  return actions.filter(isSemanticExecutionAction).length;
}

function isSemanticExecutionAction(action: GuidedAction): boolean {
  return action.type === 'executeTool' || action.type === 'drawMaskPath';
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0);
}
