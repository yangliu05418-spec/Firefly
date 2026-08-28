import { compileGuidedToolCall, inspectGuidedToolCall } from '../../../guidedActions';
import type { AIToolExecutionOptions } from '../../types';

const BRIDGE_GUIDED_OPTIONS_ARG = '__guidedOptions';

export function resolveBridgeToolExecution(
  args: unknown,
  options: unknown,
): { args: Record<string, unknown>; options: AIToolExecutionOptions } {
  const normalizedArgs = isRecord(args) ? args : {};
  const inlineOptions = normalizedArgs[BRIDGE_GUIDED_OPTIONS_ARG];
  const toolArgs = { ...normalizedArgs };
  delete toolArgs[BRIDGE_GUIDED_OPTIONS_ARG];

  return {
    args: toolArgs,
    options: sanitizeBridgeToolOptions(mergeBridgeOptions(inlineOptions, options)),
  };
}

function mergeBridgeOptions(inlineOptions: unknown, hmrOptions: unknown): unknown {
  if (isRecord(inlineOptions) || isRecord(hmrOptions)) {
    return {
      ...(isRecord(inlineOptions) ? inlineOptions : {}),
      ...(isRecord(hmrOptions) ? hmrOptions : {}),
    };
  }
  return hmrOptions ?? inlineOptions;
}

function sanitizeBridgeToolOptions(options: unknown): AIToolExecutionOptions {
  if (!isRecord(options)) {
    return {};
  }

  const sanitized: AIToolExecutionOptions = {};

  if (typeof options.guidedReplay === 'boolean') {
    sanitized.guidedReplay = options.guidedReplay;
  }

  if (typeof options.guidedAnimationBudgetMs === 'number' && Number.isFinite(options.guidedAnimationBudgetMs)) {
    sanitized.guidedAnimationBudgetMs = clampGuidedReplayBudgetMs(options.guidedAnimationBudgetMs);
  }

  if (isGuidedVisualizationMode(options.guidedVisualizationMode)) {
    sanitized.guidedVisualizationMode = options.guidedVisualizationMode;
  }

  if (isGuidedCompressionMode(options.guidedCompressionMode)) {
    sanitized.guidedCompressionMode = options.guidedCompressionMode;
  }

  if (isGuidedLegacyFeedback(options.guidedLegacyFeedback)) {
    sanitized.guidedLegacyFeedback = options.guidedLegacyFeedback;
  }

  return sanitized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGuidedVisualizationMode(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedVisualizationMode']> {
  return value === 'off' || value === 'concise' || value === 'full';
}

function isGuidedCompressionMode(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedCompressionMode']> {
  return value === 'none' || value === 'family' || value === 'aggressive';
}

function isGuidedLegacyFeedback(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedLegacyFeedback']> {
  return value === 'native' || value === 'bridge' || value === 'off';
}

function clampGuidedReplayBudgetMs(value: number): number {
  return Math.max(0, Math.round(value));
}


export function inspectGuidedBridgeTool(args: Record<string, unknown>) {
  const tool = typeof args.tool === 'string'
    ? args.tool
    : typeof args.name === 'string'
      ? args.name
      : '';
  const toolArgs = isRecord(args.args) ? args.args : {};

  if (!tool) {
    return { success: false, error: 'Missing guided tool name. Pass { tool, args }.' };
  }

  const toolCall = { tool, args: toolArgs };
  const compiled = compileGuidedToolCall(toolCall);
  return {
    success: true,
    data: {
      actions: inspectGuidedToolCall(toolCall),
      diagnostics: compiled.diagnostics,
      tool,
    },
  };
}
