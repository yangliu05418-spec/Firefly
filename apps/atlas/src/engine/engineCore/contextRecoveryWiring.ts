// WebGPUContext lifecycle wiring for WebGPUEngine (extracted, packet 345).
// Registers the device-lost / device-restored / power-preference-fallback
// callbacks in exactly the order and shape the engine constructor used inline.

import { Logger } from '../../services/logger';
import { useSettingsStore } from '../../stores/settingsStore';
import type { WebGPUContext } from '../core/WebGPUContext';

const log = Logger.create('WebGPUEngine');

export interface ContextRecoveryHandlers {
  setRecovering(recovering: boolean): void;
  handleDeviceLost(): void;
  handleDeviceRestored(): void;
}

export function wireContextRecovery(context: WebGPUContext, handlers: ContextRecoveryHandlers): void {
  // Device recovery handlers
  context.onDeviceLost((reason) => {
    log.warn('Device lost', { reason });
    handlers.setRecovering(true);
    handlers.handleDeviceLost();
  });

  context.onDeviceRestored(() => {
    log.info('Device restored');
    handlers.handleDeviceRestored();
    handlers.setRecovering(false);
  });

  context.onPowerPreferenceFallback((preference) => {
    try {
      useSettingsStore.getState().setGpuPowerPreference(preference);
      log.info('Persisted GPU power preference fallback', { preference });
    } catch (e) {
      log.error('Failed to persist GPU power preference fallback', e);
    }
  });
}
