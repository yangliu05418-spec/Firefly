import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readSource(repoPath: string): string {
  return readFileSync(path.join(repoRoot, repoPath), 'utf8');
}

describe('worker render host runtime boundary', () => {
  const workerRuntimeBoundaryPaths = [
    'src/services/render/workerRenderHostRuntimeCommands.ts',
    'src/services/render/workerRenderHostRuntimeHandlers.ts',
    'src/services/render/workerRenderHostRuntimeBridge.ts',
    'src/workers/runtimeHost.worker.ts',
  ];

  it('keeps RenderFrameSnapshot out of worker runtime command payloads', () => {
    const commandSource = readSource('src/services/render/workerRenderHostRuntimeCommands.ts');

    expect(commandSource).toContain('WorkerRenderSoftwareFrame');
    expect(commandSource).toMatch(/readonly frame: WorkerRenderSoftwareFrame/);
    expect(commandSource).not.toMatch(/\bRenderFrameSnapshot\b/);
    expect(commandSource).not.toMatch(/renderFrameSnapshot/);
  });

  it('keeps legacy Layer payloads on the main-side adapter boundary', () => {
    for (const repoPath of workerRuntimeBoundaryPaths) {
      const source = readSource(repoPath);

      expect(source, repoPath).not.toMatch(/from ['"][^'"]*(?:\.\.\/)+types['"]/);
      expect(source, repoPath).not.toMatch(/\bLayer(?:\[\]|<|>|\b)/);
      expect(source, repoPath).not.toMatch(/\bRenderTimelineClipSnapshot\b/);
      expect(source, repoPath).not.toMatch(/\bRenderFrameSnapshot\b/);
    }
  });

  it('keeps the only current Layer to worker-frame conversion in explicit adapters', () => {
    const adapterSources = [
      'src/services/render/workerSoftwarePreviewFrame.ts',
      'src/services/render/workerSoftwareNestedComposition.ts',
    ].map((repoPath) => readSource(repoPath));

    expect(adapterSources.join('\n')).toMatch(/import type \{[^}]*Layer/);
    expect(adapterSources.join('\n')).toContain('WorkerRenderSoftwareFrame');
  });
});
