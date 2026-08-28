import type { AIToolExecutionOptions } from '../aiTools/types';
import {
  DEFAULT_GUIDED_ANIMATION_BUDGET,
  normalizeGuidedAnimationBudget,
} from './scheduler';
import type {
  CallerContext,
  GuidedAction,
  GuidedAnimationBudget,
  GuidedExecutionContext,
  GuidedLegacyFeedbackMode,
  GuidedToolCall,
  ToolResult,
} from './types';
import type { GuidedActionHandlerMap } from './runtime';

export type SemanticToolExecutor = (
  tool: string,
  args: Record<string, unknown>,
  callerContext: CallerContext,
  options?: AIToolExecutionOptions,
) => Promise<ToolResult>;

export interface SemanticExecutionAdapterOptions {
  defaultCallerContext?: CallerContext;
  defaultLegacyFeedback?: GuidedLegacyFeedbackMode;
  executeTool: SemanticToolExecutor;
}

export interface SemanticExecutionRequest {
  animationBudget?: Partial<GuidedAnimationBudget> | number;
  callerContext?: CallerContext;
  executionContext?: GuidedExecutionContext;
  legacyFeedback?: GuidedLegacyFeedbackMode;
  signal?: AbortSignal;
}

export class SemanticExecutionAdapter {
  private defaultCallerContext: CallerContext;
  private defaultLegacyFeedback: GuidedLegacyFeedbackMode;
  private executeTool: SemanticToolExecutor;

  constructor(options: SemanticExecutionAdapterOptions) {
    this.defaultCallerContext = options.defaultCallerContext ?? 'internal';
    this.defaultLegacyFeedback = options.defaultLegacyFeedback ?? 'bridge';
    this.executeTool = options.executeTool;
  }

  createActionHandlers(request: SemanticExecutionRequest = {}): GuidedActionHandlerMap {
    return {
      executeTool: (action, context) => {
        if (action.type !== 'executeTool') {
          return createUnsupportedActionResult(action);
        }
        return this.executeToolAction(action, {
          ...request,
          executionContext: request.executionContext ?? context.executionContext,
          signal: request.signal ?? context.signal,
        });
      },
    };
  }

  async executeToolCall(
    toolCall: GuidedToolCall,
    request: SemanticExecutionRequest = {},
  ): Promise<ToolResult> {
    return this.executeToolCallInternal(toolCall.tool, toolCall.args, request);
  }

  async executeToolAction(
    action: Extract<GuidedAction, { type: 'executeTool' }>,
    request: SemanticExecutionRequest = {},
  ): Promise<ToolResult> {
    return this.executeToolCallInternal(action.tool, action.args, request);
  }

  private async executeToolCallInternal(
    tool: string,
    args: Record<string, unknown>,
    request: SemanticExecutionRequest,
  ): Promise<ToolResult> {
    const signal = request.signal ?? request.executionContext?.abortSignal;
    if (signal?.aborted) {
      return createCancelledToolResult(tool, request.executionContext?.sessionId);
    }

    const callerContext = request.callerContext
      ?? request.executionContext?.callerContext
      ?? this.defaultCallerContext;
    const legacyFeedback = request.legacyFeedback
      ?? request.executionContext?.legacyFeedback
      ?? this.defaultLegacyFeedback;
    const animationBudget = getAnimationBudget(request);

    try {
      return await this.executeTool(tool, args, callerContext, {
        guidedSessionId: request.executionContext?.sessionId,
        legacyFeedback,
        signal,
        staggerBudgetMs: getLegacyStaggerBudgetMs(animationBudget, legacyFeedback),
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Semantic guided execution failed',
        data: {
          guidedSessionId: request.executionContext?.sessionId,
          tool,
        },
      };
    }
  }
}

export function getLegacyStaggerBudgetMs(
  animationBudget: GuidedAnimationBudget,
  legacyFeedback: GuidedLegacyFeedbackMode,
): number {
  if (legacyFeedback === 'off' || animationBudget.disabled || animationBudget.totalMs <= 0) {
    return 0;
  }
  return Math.min(3000, animationBudget.totalMs);
}

function getAnimationBudget(request: SemanticExecutionRequest): GuidedAnimationBudget {
  if (request.animationBudget !== undefined) {
    return normalizeGuidedAnimationBudget(request.animationBudget);
  }
  return request.executionContext?.animationBudget ?? DEFAULT_GUIDED_ANIMATION_BUDGET;
}

function createCancelledToolResult(tool: string, guidedSessionId?: string): ToolResult {
  return {
    success: false,
    error: 'Guided semantic execution cancelled',
    data: {
      cancelled: true,
      guidedSessionId,
      tool,
    },
  };
}

function createUnsupportedActionResult(action: GuidedAction): ToolResult {
  return {
    success: false,
    error: `Unsupported semantic action "${action.type}"`,
  };
}
