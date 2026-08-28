export function importAudioMixerPanel() {
  return import('./AudioMixerPanel').then((module) => ({ default: module.AudioMixerPanel }));
}
