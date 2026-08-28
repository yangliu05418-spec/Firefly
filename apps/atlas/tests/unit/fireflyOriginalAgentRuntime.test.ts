import { describe, expect, it } from 'vitest';

import {
  ORIGINAL_ATLAS_AGENT_CATALOG_DIGEST,
  ORIGINAL_ATLAS_AGENT_CATALOG_VERSION,
  validateOriginalAtlasAgentPlan,
} from '../../src/firefly/OriginalAtlasAgentRuntime';
import type { AtlasAgentPlan } from '../../src/firefly/OriginalAtlasAgentClient';
import { BUILT_IN_PANEL_TYPES, getPanelConfig } from '../../src/stores/dockStore/panelRegistry';

function plan(tool: string, args: Record<string, unknown>): AtlasAgentPlan {
  return {
    version: 1,
    summary: '安全测试',
    catalogVersion: ORIGINAL_ATLAS_AGENT_CATALOG_VERSION,
    catalogDigest: ORIGINAL_ATLAS_AGENT_CATALOG_DIGEST,
    baseRevision: 4,
    planDigest: 'plan-digest',
    operations: [{
      sequence: 1,
      tool,
      args,
      risk: 'low',
      requiresConfirmation: false,
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
    expect(validateOriginalAtlasAgentPlan(plan('split_clip', { clipId: 'clip-1', atMs: 1200 }))).toBeNull();
  });

  it('fails closed for an unknown tool or a changed catalog', () => {
    expect(validateOriginalAtlasAgentPlan(plan('write_zustand_store', { value: true }))).toMatch(/无法安全执行/);
    expect(validateOriginalAtlasAgentPlan({ ...plan('delete_clip', { clipId: 'clip-1' }), catalogDigest: 'stale' })).toMatch(/工具目录已更新/);
  });

  it('rejects invalid or prototype-bearing operation arguments', () => {
    expect(validateOriginalAtlasAgentPlan(plan('trim_clip', { clipId: 'clip-1', sourceInMs: 500, sourceOutMs: 200 }))).toMatch(/修剪范围无效/);
    const unsafe = Object.create({ inherited: true }) as Record<string, unknown>;
    unsafe.clipId = 'clip-1';
    expect(validateOriginalAtlasAgentPlan(plan('delete_clip', unsafe))).toMatch(/无法安全执行/);
  });
});
