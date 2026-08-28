export function stopStream(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach(track => track.stop());
}

export function createAudioInputConstraints(inputDeviceId?: string): MediaStreamConstraints {
  return {
    audio: inputDeviceId
      ? {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        deviceId: { exact: inputDeviceId },
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: { ideal: 48000 },
      }
      : {
        autoGainControl: false,
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: { ideal: 48000 },
      },
    video: false,
  };
}

export function getAudioContextConstructor(): typeof AudioContext | undefined {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
}

export function disconnectAudioNode(node: AudioNode | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // Already disconnected or never connected.
  }
}
