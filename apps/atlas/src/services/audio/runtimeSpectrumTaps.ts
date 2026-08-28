// runtimeSpectrumTaps - display-rate spectrum taps for live analyzer UIs.
//
// Meter snapshots travel through runtimeAudioMeterBus at whatever cadence the
// active publisher runs (media routes per render frame, stem mixer / MIDI /
// tail polls well below display rate). Spectrum analyzer UIs need display-rate
// data, so audio-graph owners register a tap per meter scope here and
// consumers sample the tap once per animation frame, falling back to bus
// snapshots when no tap is live.
//
// Reader contract: a reader returns the audio graph's shared FFT buffer
// (valid only until the next read on the same route) or null when the scope
// has no live analyser. Consumers must copy the values synchronously.

import type { RuntimeAudioMeterScope } from './runtimeAudioMeterBus';

export type SpectrumTapReader = () => Float32Array | null;

class RuntimeSpectrumTaps {
  private master: SpectrumTapReader | null = null;
  private tracks = new Map<string, SpectrumTapReader>();

  /** Register (or replace) the master-scope tap. */
  registerMaster(reader: SpectrumTapReader): () => void {
    this.master = reader;
    return () => {
      if (this.master === reader) this.master = null;
    };
  }

  /** Register (or replace) the tap for one track scope. */
  registerTrack(trackId: string, reader: SpectrumTapReader): () => void {
    this.tracks.set(trackId, reader);
    return () => {
      if (this.tracks.get(trackId) === reader) this.tracks.delete(trackId);
    };
  }

  unregisterTrack(trackId: string): void {
    this.tracks.delete(trackId);
  }

  /** Drop all track taps (project reset); the master tap stays registered. */
  clearAllTracks(): void {
    this.tracks.clear();
  }

  /**
   * Sample the live spectrum for a scope. Returns the shared FFT buffer of the
   * underlying route (copy synchronously) or null when no tap is live.
   */
  read(scope: RuntimeAudioMeterScope): Float32Array | null {
    const reader = scope.kind === 'master' ? this.master : this.tracks.get(scope.trackId);
    if (!reader) return null;
    return reader();
  }

  /** Test-only: drop all registered taps. */
  resetForTest(): void {
    this.master = null;
    this.tracks.clear();
  }
}

// HMR-safe singleton: registered taps belong to runtime owners (routing
// manager, sync handler) that survive HMR themselves.
let instance: RuntimeSpectrumTaps | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.runtimeSpectrumTaps) {
    instance = import.meta.hot.data.runtimeSpectrumTaps as RuntimeSpectrumTaps;
  }
  import.meta.hot.dispose((data) => {
    data.runtimeSpectrumTaps = instance;
  });
}

if (!instance) {
  instance = new RuntimeSpectrumTaps();
}

export const runtimeSpectrumTaps = instance;
