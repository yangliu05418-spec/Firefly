export interface ExportCapability {
  id: 'webcodecs' | 'h264' | 'audio' | 'isolation' | 'storage';
  supported: boolean | null;
  detail?: string;
}

export interface BrowserSupport {
  desktop: boolean;
  chromium: boolean;
  webCodecs: boolean;
}

export function detectBrowserSupport(): BrowserSupport {
  const userAgent = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const chromium = /Chrome|Chromium|Edg\//i.test(userAgent) && !/OPR\//i.test(userAgent);
  return {
    desktop: !mobile,
    chromium,
    webCodecs: 'VideoEncoder' in window && 'VideoDecoder' in window,
  };
}

export async function inspectExportCapabilities(): Promise<ExportCapability[]> {
  const hasWebCodecs = 'VideoEncoder' in window && 'VideoDecoder' in window;
  let h264: boolean | null = null;
  if (hasWebCodecs) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001f',
        width: 1920,
        height: 1080,
        bitrate: 8_000_000,
        framerate: 30,
      });
      h264 = result.supported === true;
    } catch {
      h264 = false;
    }
  }
  const audio = 'AudioEncoder' in window;
  let storageDetail: string | undefined;
  let storageSupported: boolean | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota !== undefined && estimate.usage !== undefined) {
      const free = Math.max(0, estimate.quota - estimate.usage);
      storageDetail = formatBytes(free);
      storageSupported = free >= 1024 * 1024 * 1024;
    }
  } catch {
    storageSupported = null;
  }
  return [
    { id: 'webcodecs', supported: hasWebCodecs },
    { id: 'h264', supported: h264 },
    { id: 'audio', supported: audio },
    { id: 'isolation', supported: window.crossOriginIsolated },
    { id: 'storage', supported: storageSupported, detail: storageDetail },
  ];
}

export function canExport(capabilities: ExportCapability[]): boolean {
  return capabilities.every((capability) => capability.id === 'storage' ? capability.supported !== false : capability.supported === true);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}
