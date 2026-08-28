import { describe, expect, it } from 'vitest';
import { checkToolAccess, getToolPolicy, normalizeToolName } from '../../src/services/aiTools/policy';

// Guards the fix for OpenAI tool calls arriving as `functions.<name>` (e.g.
// `functions.addClipSegment`), which previously failed dispatch as
// "Unknown tool: functions.addClipSegment" and left the timeline untouched.

describe('tool name normalization', () => {
  it('strips the OpenAI `functions.` namespace prefix', () => {
    expect(normalizeToolName('functions.addClipSegment')).toBe('addClipSegment');
    expect(normalizeToolName('  functions.executeBatch ')).toBe('executeBatch');
  });

  it('leaves already-clean names unchanged', () => {
    expect(normalizeToolName('addClipSegment')).toBe('addClipSegment');
    expect(normalizeToolName('getTimelineState')).toBe('getTimelineState');
  });

  it('resolves policy for a prefixed tool name identically to the clean name', () => {
    expect(getToolPolicy('functions.addClipSegment')).toBe(getToolPolicy('addClipSegment'));
    expect(getToolPolicy('functions.addClipSegment')).toBeDefined();
    expect(getToolPolicy('functions.executeBatch')).toBe(getToolPolicy('executeBatch'));
  });

  it('grants caller access for a prefixed tool name', () => {
    const prefixed = checkToolAccess('functions.addClipSegment', 'chat');
    const clean = checkToolAccess('addClipSegment', 'chat');
    expect(prefixed.allowed).toBe(true);
    expect(prefixed).toEqual(clean);
  });

  it('still rejects genuinely unknown tools (without the prefix in the reason)', () => {
    const result = checkToolAccess('functions.totallyMadeUpTool', 'chat');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Unknown tool: totallyMadeUpTool');
  });
});
