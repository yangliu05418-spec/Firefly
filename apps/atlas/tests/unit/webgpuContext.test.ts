import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebGPUContext } from '../../src/engine/core/WebGPUContext';

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

describe('WebGPUContext', () => {
  const originalGpu = navigator.gpu;
  const originalPlatform = navigator.platform;
  const originalUserAgent = navigator.userAgent;
  const originalUserAgentData = (navigator as Navigator & { userAgentData?: unknown }).userAgentData;

  afterEach(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: originalGpu,
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: originalUserAgentData,
    });
  });

  function createDevice(): GPUDevice {
    return {
      lost: new Promise<GPUDeviceLostInfo>(() => {}),
      destroy: vi.fn(),
    } as unknown as GPUDevice;
  }

  function createAdapter(device = createDevice()): GPUAdapter {
    return {
      limits: {
        maxTextureDimension2D: 8192,
        maxStorageBufferBindingSize: 2147483644,
        maxBufferSize: 2147483644,
      },
      requestDevice: vi.fn(async () => device),
    } as unknown as GPUAdapter;
  }

  it('requests large storage buffer limits when the adapter supports them', async () => {
    const device = createDevice();
    const requestDevice = vi.fn(async () => device);
    const adapter = {
      limits: {
        maxTextureDimension2D: 8192,
        maxStorageBufferBindingSize: 2147483644,
        maxBufferSize: 2147483644,
      },
      requestDevice,
    } as unknown as GPUAdapter;

    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const success = await context.initialize();

    expect(success).toBe(true);
    expect(requestDevice).toHaveBeenCalledWith(expect.objectContaining({
      requiredFeatures: [],
      requiredLimits: expect.objectContaining({
        maxTextureDimension2D: 4096,
        maxStorageBufferBindingSize: 2147483644,
        maxBufferSize: 2147483644,
      }),
    }));
  });

  it('uses low-power fallback on Linux when high-performance adapter selection fails', async () => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    });

    const adapter = createAdapter();
    const requestAdapter = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adapter);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const fallbackCallback = vi.fn();
    context.onPowerPreferenceFallback(fallbackCallback);
    const success = await context.initialize('high-performance');

    expect(success).toBe(true);
    expect(requestAdapter).toHaveBeenNthCalledWith(1, { powerPreference: 'high-performance' });
    expect(requestAdapter).toHaveBeenNthCalledWith(2, { powerPreference: 'low-power' });
    expect(context.getPowerPreference()).toBe('low-power');
    expect(fallbackCallback).toHaveBeenCalledWith('low-power');
  });

  it('keeps the no-preference fallback on Windows instead of forcing low-power', async () => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const adapter = createAdapter();
    const requestAdapter = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adapter);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const fallbackCallback = vi.fn();
    context.onPowerPreferenceFallback(fallbackCallback);
    const success = await context.initialize('high-performance');

    expect(success).toBe(true);
    expect(requestAdapter).toHaveBeenNthCalledWith(1, { powerPreference: 'high-performance' });
    expect(requestAdapter).toHaveBeenNthCalledWith(2);
    expect(requestAdapter).not.toHaveBeenCalledWith({ powerPreference: 'low-power' });
    expect(context.getPowerPreference()).toBe('high-performance');
    expect(fallbackCallback).not.toHaveBeenCalled();
  });
});
