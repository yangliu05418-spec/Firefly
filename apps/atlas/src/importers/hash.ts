export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type Sha256Input = ArrayBuffer | ArrayBufferView;
type CryptoDigestBytes = Uint8Array<ArrayBuffer>;

function copyCryptoDigestBytes(source: Uint8Array): CryptoDigestBytes {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function toCryptoDigestBytes(input: Sha256Input): CryptoDigestBytes {
  const source = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);

  return copyCryptoDigestBytes(source);
}

export async function sha256ArrayBuffer(buffer: Sha256Input): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toCryptoDigestBytes(buffer));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function sha256Utf8(value: string): Promise<string> {
  return sha256ArrayBuffer(new TextEncoder().encode(value));
}
