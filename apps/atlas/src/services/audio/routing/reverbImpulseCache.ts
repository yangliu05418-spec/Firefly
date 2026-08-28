import type { AudioRoutingDebugCounters } from './routeGraphTypes';

export const REVERB_IMPULSE_CACHE_LIMIT = 24;

function reverbImpulseCacheKey(
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): string {
  return [
    ctx.sampleRate,
    roomSize.toFixed(3),
    decaySeconds.toFixed(3),
    damping.toFixed(3),
  ].join(':');
}

function createReverbImpulse(
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * decaySeconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const highDamping = 0.08 + damping * 0.72;
  const roomGain = 0.18 + roomSize * 0.42;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let filteredNoise = 0;
    let seed = 0x12345678 + channel * 0x9e3779b9;
    for (let index = 0; index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      filteredNoise = filteredNoise * highDamping + noise * (1 - highDamping);
      const decay = Math.pow(1 - index / length, 2.4 + damping * 2.2);
      data[index] = filteredNoise * decay * roomGain;
    }
  }

  return buffer;
}

export function clearReverbImpulseCache(
  cache: Map<string, AudioBuffer>,
  counters: AudioRoutingDebugCounters,
): number {
  const clearedEntries = cache.size;
  if (clearedEntries === 0) return 0;
  cache.clear();
  counters.reverbImpulseCacheClears++;
  counters.reverbImpulseCacheClearedEntries += clearedEntries;
  return clearedEntries;
}

export function getOrCreateReverbImpulse(
  cache: Map<string, AudioBuffer>,
  counters: AudioRoutingDebugCounters,
  ctx: BaseAudioContext,
  roomSize: number,
  decaySeconds: number,
  damping: number,
): AudioBuffer {
  const key = reverbImpulseCacheKey(ctx, roomSize, decaySeconds, damping);
  const cached = cache.get(key);
  if (cached) {
    counters.reverbImpulseCacheHits++;
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const startedAt = performance.now();
  const buffer = createReverbImpulse(ctx, roomSize, decaySeconds, damping);
  const elapsedMs = performance.now() - startedAt;
  counters.reverbImpulseBuilds++;
  counters.reverbImpulseBuildMsTotal += elapsedMs;
  counters.reverbImpulseBuildMsMax = Math.max(
    counters.reverbImpulseBuildMsMax,
    elapsedMs,
  );

  cache.set(key, buffer);
  while (cache.size > REVERB_IMPULSE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
    counters.reverbImpulseCacheEvictions++;
  }
  return buffer;
}
