import { describe, expect, it } from 'vitest';

import { selectRenderHost } from '../../src/services/render/renderHostSelection';

describe('render host selection', () => {
  it('keeps the main fallback when worker primary is not requested', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: false,
      workerPrimaryAvailable: true,
    });

    expect(selection.host).toBe(main);
    expect(selection.telemetry).toMatchObject({
      selectedId: 'main-fallback',
      selectedRole: 'fallback',
      workerPrimaryRequested: false,
      workerPrimaryRegistered: true,
      workerPrimaryAvailable: true,
    });
    expect(selection.telemetry.blockers).toContain('worker render host flag disabled');
  });

  it('does not report worker availability blockers while the worker flag is disabled', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: false,
      workerPrimaryAvailable: false,
    });

    expect(selection.host).toBe(main);
    expect(selection.telemetry.blockers).toEqual(['worker render host flag disabled']);
    expect(selection.telemetry.workerPrimaryRegistered).toBe(true);
    expect(selection.telemetry.workerPrimaryAvailable).toBe(false);
  });

  it('selects worker primary only when requested, registered, and available', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: true,
      workerPrimaryAvailable: true,
    });

    expect(selection.host).toBe(worker);
    expect(selection.telemetry).toEqual({
      selectedId: 'worker-primary',
      selectedRole: 'primary',
      workerPrimaryRequested: true,
      workerPrimaryRegistered: true,
      workerPrimaryAvailable: true,
      blockers: [],
      reason: 'using worker primary render host',
    });
  });

  it('reports why requested worker primary cannot mount yet', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: true,
      workerPrimaryAvailable: false,
      workerPrimaryBlockers: ['W5_VISIBLE_PRESENTATION_PROVEN:blocked'],
    });

    expect(selection.host).toBe(main);
    expect(selection.telemetry).toMatchObject({
      selectedId: 'main-fallback',
      workerPrimaryRequested: true,
      workerPrimaryRegistered: true,
      workerPrimaryAvailable: false,
      blockers: ['W5_VISIBLE_PRESENTATION_PROVEN:blocked'],
    });
  });
});
