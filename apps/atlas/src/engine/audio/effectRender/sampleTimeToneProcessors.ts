import {
  clamp,
  createMutableAudioBufferLike,
  createNumericSampleParamReader,
  dbToLinearGain,
  getNumericEffectParam,
  hasEffectParamKeyframes,
  type EffectRenderKeyframe,
  type RenderableAudioEffectInstance,
} from './audioEffectRenderContracts';

export function applyDelay(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const staticMix = clamp(getNumericEffectParam(effect, 'mix', 0), 0, 1);
  if (staticMix <= 0.0001 && !hasEffectParamKeyframes(keyframes, effect.id, 'mix')) {
    return buffer;
  }

  const readDelayMs = createNumericSampleParamReader(
    effect,
    'delayMs',
    250,
    keyframes,
    value => clamp(value, 1, 2000),
  );
  const readFeedback = createNumericSampleParamReader(
    effect,
    'feedback',
    0,
    keyframes,
    value => clamp(value, 0, 0.95),
  );
  const readMix = createNumericSampleParamReader(
    effect,
    'mix',
    0,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const readToneHz = createNumericSampleParamReader(
    effect,
    'toneHz',
    12000,
    keyframes,
    value => clamp(value, 20, buffer.sampleRate / 2 - 1),
  );
  const maxDelaySamples = Math.max(1, Math.round(buffer.sampleRate * 2));
  const ringLength = maxDelaySamples + 1;
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    const feedbackBuffer = new Float32Array(ringLength);
    let writeIndex = 0;
    let toneState = 0;

    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const dry = input[index] ?? 0;
      const delaySamples = Math.max(1, Math.min(maxDelaySamples, Math.round(buffer.sampleRate * readDelayMs(time) / 1000)));
      const readIndex = (writeIndex - delaySamples + ringLength) % ringLength;
      const delayed = feedbackBuffer[readIndex] ?? 0;
      const toneAlpha = 1 - Math.exp(-2 * Math.PI * readToneHz(time) / buffer.sampleRate);
      toneState += toneAlpha * (delayed - toneState);
      const wet = toneState;
      const feedback = readFeedback(time);
      const mix = readMix(time);
      feedbackBuffer[writeIndex] = clamp(dry + wet * feedback, -4, 4);
      target[index] = dry * (1 - mix) + wet * mix;
      writeIndex = (writeIndex + 1) % ringLength;
    }
  }

  return output;
}

export function applyReverb(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const staticMix = clamp(getNumericEffectParam(effect, 'mix', 0), 0, 1);
  if (staticMix <= 0.0001 && !hasEffectParamKeyframes(keyframes, effect.id, 'mix')) {
    return buffer;
  }

  const readMix = createNumericSampleParamReader(
    effect,
    'mix',
    0,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const readDecaySeconds = createNumericSampleParamReader(
    effect,
    'decaySeconds',
    1.2,
    keyframes,
    value => clamp(value, 0.1, 12),
  );
  const readDamping = createNumericSampleParamReader(
    effect,
    'damping',
    0.35,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const roomSize = clamp(getNumericEffectParam(effect, 'roomSize', 0.35), 0, 1);
  const output = createMutableAudioBufferLike(buffer);
  const baseDelaysMs = [23, 31, 37, 43, 53, 61];
  const roomScale = 0.35 + roomSize * 1.65;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    const channelOffset = channel * 0.17;
    const delays = baseDelaysMs.map(delayMs =>
      Math.max(1, Math.round(buffer.sampleRate * (delayMs * (roomScale + channelOffset)) / 1000))
    );
    const lines = delays.map(delay => new Float32Array(delay));
    const positions = delays.map(() => 0);
    const filtered = delays.map(() => 0);

    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const dry = input[index] ?? 0;
      let wet = 0;
      const dampingKeep = 1 - readDamping(time) * 0.72;
      const decaySeconds = readDecaySeconds(time);

      for (let tap = 0; tap < lines.length; tap += 1) {
        const line = lines[tap];
        const position = positions[tap];
        const delayed = line[position] ?? 0;
        const delaySeconds = delays[tap] / buffer.sampleRate;
        const feedback = clamp(Math.pow(0.001, delaySeconds / decaySeconds), 0.08, 0.93);
        filtered[tap] = filtered[tap] * (1 - dampingKeep) + delayed * dampingKeep;
        wet += filtered[tap];
        line[position] = clamp(dry + filtered[tap] * feedback, -4, 4);
        positions[tap] = (position + 1) % line.length;
      }

      wet /= Math.max(1, lines.length);
      const mix = readMix(time);
      target[index] = dry * (1 - mix) + wet * mix;
    }
  }

  return output;
}

export function applySaturation(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const staticMix = clamp(getNumericEffectParam(effect, 'mix', 0), 0, 1);
  if (staticMix <= 0.0001 && !hasEffectParamKeyframes(keyframes, effect.id, 'mix')) {
    return buffer;
  }

  const readDriveDb = createNumericSampleParamReader(
    effect,
    'driveDb',
    0,
    keyframes,
    value => Math.max(0, value),
  );
  const readToneHz = createNumericSampleParamReader(
    effect,
    'toneHz',
    16000,
    keyframes,
    value => clamp(value, 200, buffer.sampleRate / 2 - 1),
  );
  const readMix = createNumericSampleParamReader(
    effect,
    'mix',
    0,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    let toneState = 0;

    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const dry = input[index] ?? 0;
      const driveDb = readDriveDb(time);
      const driven = driveDb <= 0.001
        ? dry
        : Math.tanh(dry * dbToLinearGain(driveDb)) / Math.tanh(dbToLinearGain(driveDb));
      const toneAlpha = 1 - Math.exp(-2 * Math.PI * readToneHz(time) / buffer.sampleRate);
      toneState += toneAlpha * (driven - toneState);
      const mix = readMix(time);
      target[index] = clamp(dry * (1 - mix) + toneState * mix, -1, 1);
    }
  }

  return output;
}

export function applyDeClick(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const readThreshold = createNumericSampleParamReader(
    effect,
    'threshold',
    0.35,
    keyframes,
    value => clamp(value, 0.01, 1),
  );
  const readRatio = createNumericSampleParamReader(
    effect,
    'ratio',
    4,
    keyframes,
    value => Math.max(1, value),
  );
  const readMix = createNumericSampleParamReader(
    effect,
    'mix',
    1,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    if (buffer.length <= 2) {
      target.set(input);
      continue;
    }
    target[0] = input[0] ?? 0;
    target[buffer.length - 1] = input[buffer.length - 1] ?? 0;

    for (let index = 1; index < buffer.length - 1; index += 1) {
      const time = index / buffer.sampleRate;
      const previous = input[index - 1] ?? 0;
      const dry = input[index] ?? 0;
      const next = input[index + 1] ?? 0;
      const prediction = (previous + next) / 2;
      const residual = Math.abs(dry - prediction);
      const neighborEnergy = (Math.abs(previous) + Math.abs(next)) / 2;
      const click = residual >= readThreshold(time) && residual >= neighborEnergy * readRatio(time);
      const mix = readMix(time);
      target[index] = click ? dry * (1 - mix) + prediction * mix : dry;
    }
  }

  return output;
}
