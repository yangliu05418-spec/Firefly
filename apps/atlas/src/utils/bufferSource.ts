export type BinaryBufferSource = ArrayBuffer | ArrayBufferView;

function isArrayBufferLike(value: unknown): value is ArrayBufferLike {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}

export function toUint8ArrayCopy(source: BinaryBufferSource): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength) as Uint8Array<ArrayBuffer>;
    copy.set(bytes);
    return copy;
  }

  if (isArrayBufferLike(source)) {
    const bytes = new Uint8Array(source);
    const copy = new Uint8Array(bytes.byteLength) as Uint8Array<ArrayBuffer>;
    copy.set(bytes);
    return copy;
  }

  throw new TypeError('Expected an ArrayBuffer or ArrayBuffer view');
}

export function toArrayBufferCopy(source: BinaryBufferSource): ArrayBuffer {
  return toUint8ArrayCopy(source).buffer as ArrayBuffer;
}
