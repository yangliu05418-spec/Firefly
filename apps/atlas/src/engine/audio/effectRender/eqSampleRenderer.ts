import { processAudioEqCharacterChannels } from '../eq/AudioEqCharacter';
import { processAudioEqChannels } from '../eq/AudioEqDynamic';
import { hasAudioEqLinearPhaseMode, processAudioEqLinearPhaseChannels } from '../eq/AudioEqLinearPhase';
import { hasAudioEqSpectralDynamicsBands, processAudioEqSpectralDynamicsChannels } from '../eq/AudioEqSpectralDynamics';
import { createMutableAudioBufferLike, type RenderableAudioEffectInstance } from './audioEffectRenderContracts';

export function applySampleAccurateEQ(
  buffer: AudioBuffer,
  eqEffect: RenderableAudioEffectInstance,
): AudioBuffer {
  const inputChannels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  const eqResult = hasAudioEqLinearPhaseMode(eqEffect.params)
    ? processAudioEqLinearPhaseChannels(inputChannels, eqEffect.params, {
        sampleRate: buffer.sampleRate,
      })
    : processAudioEqChannels(
        hasAudioEqSpectralDynamicsBands(eqEffect.params)
          ? processAudioEqSpectralDynamicsChannels(inputChannels, eqEffect.params, {
              sampleRate: buffer.sampleRate,
            }).channels
          : inputChannels,
        eqEffect.params,
        { sampleRate: buffer.sampleRate },
      );
  const characterResult = processAudioEqCharacterChannels(eqResult.channels, eqEffect.params, {
    sampleRate: buffer.sampleRate,
  });
  const output = createMutableAudioBufferLike(buffer);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    output.getChannelData(channel).set(characterResult.channels[channel] ?? inputChannels[channel]);
  }
  return output;
}
