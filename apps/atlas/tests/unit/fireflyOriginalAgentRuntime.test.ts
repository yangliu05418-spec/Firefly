import { describe, expect, it } from 'vitest';

import { validateOriginalAtlasAgentPlan } from '../../src/firefly/OriginalAtlasAgentRuntime';
import { ATLAS_AGENT_CATALOGS } from '../../src/firefly/atlas-agent-catalog.generated';
import type { AtlasAgentPlan } from '../../src/firefly/OriginalAtlasAgentClient';
import { BUILT_IN_PANEL_TYPES, getPanelConfig } from '../../src/stores/dockStore/panelRegistry';

function plan(tool: string, args: Record<string, unknown>): AtlasAgentPlan {
  return {
    version: 1,
    summary: '安全测试',
    catalogVersion: ATLAS_AGENT_CATALOGS.full.version,
    catalogDigest: ATLAS_AGENT_CATALOGS.full.digest,
    baseRevision: 4,
    planDigest: 'plan-digest',
    operations: [{
      sequence: 1,
      tool,
      args,
      risk: 'low',
      requiresConfirmation: true,
      operationKey: 'operation-1',
      operationDigest: 'operation-digest',
    }],
  };
}

describe('Firefly original Atlas Agent boundary', () => {
  it('registers the Agent as an original Dock panel', () => {
    expect(BUILT_IN_PANEL_TYPES).toContain('atlas-agent');
    expect(getPanelConfig('atlas-agent').type).toBe('atlas-agent');
  });

  it('accepts a valid atomic edit operation', () => {
    expect(validateOriginalAtlasAgentPlan(plan('splitClip', { clipId: 'clip-1', splitTime: 1.2 }))).toBeNull();
  });

  it('fails closed for an unknown tool or a changed catalog', () => {
    expect(validateOriginalAtlasAgentPlan(plan('write_zustand_store', { value: true }))).toMatch(/参数无效/);
    expect(validateOriginalAtlasAgentPlan({ ...plan('deleteClip', { clipId: 'clip-1' }), catalogDigest: 'stale' })).toMatch(/工具目录已更新/);
  });

  it('rejects invalid or prototype-bearing operation arguments', () => {
    expect(validateOriginalAtlasAgentPlan(plan('trimClip', { clipId: 'clip-1', startTime: 'invalid', endTime: 2 }))).toMatch(/参数无效/);
    const unsafe = Object.create({ inherited: true }) as Record<string, unknown>;
    unsafe.clipId = 'clip-1';
    expect(validateOriginalAtlasAgentPlan(plan('deleteClip', unsafe))).toMatch(/参数无效/);
  });
});
