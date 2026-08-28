import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type AtlasProjectSummary } from './model';
import { mergeCloudAuthoritativeProjects, resolveProjectOpen } from './FireflyAtlasApp';

const project = (revision: number, overrides: Partial<AtlasProjectSummary> = {}): AtlasProjectSummary => ({
  id: 'project-1', title: '云端标题', revision, hasCheckpoint: true,
  createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', ...overrides,
});

describe('Atlas local/cloud recovery policy', () => {
  it('never lets a newer local timestamp replace cloud revision or title', () => {
    const cloud = project(8);
    const local = project(2, { title: '旧本地标题', updatedAt: '2026-08-28T00:00:00.000Z', localOnly: true });
    expect(mergeCloudAuthoritativeProjects([cloud], [local])).toEqual([cloud]);
  });

  it('shows a recovery conflict when the local draft is based on an older cloud revision', () => {
    const cloudDocument = createEmptyDocument('project-1', '云端', 8);
    const local = { ...createEmptyDocument('project-1', '本地', 3), playhead: 4 };
    expect(resolveProjectOpen({ local, cloud: cloudDocument, project: project(8), forceCloud: false, cloudKnown: true })).toEqual({ kind: 'conflict', local });
  });

  it('opens a same-base local draft without rewriting its revision', () => {
    const local = { ...createEmptyDocument('project-1', '本地', 8), playhead: 4 };
    const result = resolveProjectOpen({ local, cloud: createEmptyDocument('project-1', '云端', 8), project: project(8), forceCloud: false, cloudKnown: true });
    expect(result).toEqual({ kind: 'open', document: local });
  });

  it('uses the verified cloud document when only metadata differs', () => {
    const cloud = createEmptyDocument('project-1', '云端', 8);
    const local = { ...cloud, title: '本地标题', revision: 2, updatedAt: '2026-08-28T00:00:00.000Z' };
    expect(resolveProjectOpen({ local, cloud, project: project(8), forceCloud: false, cloudKnown: true })).toEqual({ kind: 'open', document: cloud });
  });
});
