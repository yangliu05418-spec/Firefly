import type { AudioDecodeSource, AudioDecodeSourceInfo } from '../audioDecodeTypes';

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function formatSourceInfo(sourceInfo: AudioDecodeSourceInfo): string {
  const parts = [
    `${sourceInfo.kind} source`,
    `${sourceInfo.size} bytes`,
    sourceInfo.name ? `name=${sourceInfo.name}` : undefined,
    sourceInfo.mimeType ? `mime=${sourceInfo.mimeType}` : undefined,
  ].filter(Boolean);

  return parts.join(', ');
}

export function getAudioDecodeSourceInfo(source: AudioDecodeSource): AudioDecodeSourceInfo {
  switch (source.kind) {
    case 'file':
      return {
        kind: 'file',
        size: source.file.size,
        name: source.file.name,
        mimeType: source.file.type || undefined,
      };
    case 'blob':
      return {
        kind: 'blob',
        size: source.blob.size,
        name: source.name,
        mimeType: source.mimeType ?? (source.blob.type || undefined),
      };
    case 'array-buffer':
      return {
        kind: 'array-buffer',
        size: source.arrayBuffer.byteLength,
        name: source.name,
        mimeType: source.mimeType,
      };
    case 'bytes':
      return {
        kind: 'bytes',
        size: source.bytes.byteLength,
        name: source.name,
        mimeType: source.mimeType,
      };
  }
}

export async function readAudioDecodeSourceBytes(source: AudioDecodeSource): Promise<ArrayBuffer> {
  switch (source.kind) {
    case 'file':
      return source.file.arrayBuffer();
    case 'blob':
      return source.blob.arrayBuffer();
    case 'array-buffer':
      return cloneArrayBuffer(source.arrayBuffer);
    case 'bytes':
      return bytesToArrayBuffer(source.bytes);
  }
}

export function createSourceFingerprint(sourceInfo: AudioDecodeSourceInfo): string {
  const name = sourceInfo.name ? `:${sourceInfo.name}` : '';
  const mimeType = sourceInfo.mimeType ? `:${sourceInfo.mimeType}` : '';
  return `${sourceInfo.kind}:${sourceInfo.size}${name}${mimeType}`;
}
