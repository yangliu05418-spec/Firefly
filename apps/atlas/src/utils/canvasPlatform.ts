// Shared canvas platform gates.
//
// On Linux with open-source Mesa drivers (RADV/radeonsi/NVK/llvmpipe),
// GPU-backed canvases and worker-driven OffscreenCanvas surfaces can report
// success while compositing blank pixels. Keep these decisions centralized so
// canvas/GPU work uses the same Linux fallback policy.
//
// Full reference: docs/Features/Linux-Mesa-GPU.md.
let cachedSoftwareCanvasPreference: boolean | null = null;

export function prefersSoftwareTimelineCanvas(): boolean {
  if (cachedSoftwareCanvasPreference !== null) return cachedSoftwareCanvasPreference;
  if (typeof navigator === 'undefined') {
    cachedSoftwareCanvasPreference = false;
    return cachedSoftwareCanvasPreference;
  }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  cachedSoftwareCanvasPreference = /linux/i.test(platform) && !/android/i.test(navigator.userAgent || '');
  return cachedSoftwareCanvasPreference;
}

export function resetCanvasPlatformPreferenceForTests(): void {
  cachedSoftwareCanvasPreference = null;
}
