import { describe, expect, it, vi } from 'vitest';
import {
  GuidedActionRuntime,
  SemanticExecutionAdapter,
  normalizeGuidedAnimationBudget,
} from '../../src/services/guidedActions';
import type {
  GuidedExecutionContext,
  GuidedToolCall,
  SemanticToolExecutor,
} from '../../src/services/guidedActions';

describe('guided semantic execution adapter', () => {
  it('passes caller context, session id, and zero stagger for instant guided execution', async () => {
    const executor = vi.fn<SemanticToolExecutor>(async () => ({ success: true, data: { ok: true } }));
    const adapter = new SemanticExecutionAdapter({ executeTool: executor });
    const controller = new AbortController();
    const context = createExecutionContext(controller.signal, normalizeGuidedAnimationBudget(0));
    const toolCall: GuidedToolCall = {
      tool: 'setTransform',
      args: { clipId: 'clip-1', x: 120 },
    };

    const result = await adapter.executeToolCall(toolCall, { executionContext: context });

    expect(result.success).toBe(true);
    expect(executor).toHaveBeenCalledWith('setTransform', toolCall.args, 'chat', expect.objectContaining({
      guidedSessionId: 'guided-semantic-test',
      legacyFeedback: 'bridge',
      signal: controller.signal,
      staggerBudgetMs: 0,
    }));
  });

  it('returns a deterministic cancellation result before the executor is called', async () => {
    const executor = vi.fn<SemanticToolExecutor>(async () => ({ success: true }));
    const adapter = new SemanticExecutionAdapter({ executeTool: executor });
    const controller = new AbortController();
    controller.abort();

    const result = await adapter.executeToolCall(
      { tool: 'splitClip', args: { clipId: 'clip-1', splitTime: 4 } },
      { executionContext: createExecutionContext(controller.signal) },
    );

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Guided semantic execution cancelled',
    }));
    expect(result.data).toEqual(expect.objectContaining({
      cancelled: true,
      guidedSessionId: 'guided-semantic-test',
      tool: 'splitClip',
    }));
    expect(executor).not.toHaveBeenCalled();
  });

  it('plugs into GuidedActionRuntime executeTool handlers', async () => {
    const executor = vi.fn<SemanticToolExecutor>(async (tool) => ({ success: true, data: { tool } }));
    const adapter = new SemanticExecutionAdapter({ executeTool: executor });
    const runtime = new GuidedActionRuntime({
      actionHandlers: adapter.createActionHandlers(),
    });

    const result = await runtime.startSession({
      sessionId: 'semantic-runtime',
      callerContext: 'chat',
      animationBudget: 0,
      actions: [
        { type: 'executeTool', tool: 'setTransform', args: { clipId: 'clip-1', y: 20 } },
      ],
    });

    expect(result.status).toBe('completed');
    expect(result.toolResults).toEqual([
      expect.objectContaining({ success: true, data: { tool: 'setTransform' } }),
    ]);
    expect(executor).toHaveBeenCalledOnce();
  });
});

function createExecutionContext(
  signal: AbortSignal,
  animationBudget = normalizeGuidedAnimationBudget({ totalMs: 1000 }),
): GuidedExecutionContext {
  return {
    sessionId: 'guided-semantic-test',
    callerContext: 'chat',
    playbackMode: 'aiReplay',
    visualizationMode: animationBudget.disabled ? 'off' : 'concise',
    animationBudget,
    inputLock: { mode: 'locked', allowCancel: true },
    legacyFeedback: 'bridge',
    abortSignal: signal,
  };
}
