import type {
  Command,
  EncodeOutput,
  FileMetadata,
} from './protocol';
import type {
  DecodedFrame,
  NativeHelperCommandHost,
} from './nativeHelperClientTypes';
import { getErrorMessage, okField } from './nativeHelperResponseUtils';

export async function openFile(host: NativeHelperCommandHost, path: string): Promise<FileMetadata> {
  const id = host.nextId();
  const response = await host.send({ cmd: 'open', id, path });

  if (!response.ok) {
    throw new Error(getErrorMessage(response, 'Failed to open file'));
  }

  return response as unknown as FileMetadata;
}

export async function decodeFrame(
  host: NativeHelperCommandHost,
  fileId: string,
  frame: number,
  options?: {
    format?: 'rgba8' | 'rgb8' | 'yuv420';
    scale?: number;
    compression?: 'lz4';
  },
): Promise<DecodedFrame> {
  const id = host.nextId();

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      host.deleteFrameCallback(id);
      host.deletePendingRequest(id);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Decode timeout'));
    }, 10000);

    host.registerFrameCallback(id, (decoded) => {
      cleanup();
      resolve(decoded);
    });

    host.registerPendingRequest(id, (response) => {
      cleanup();
      const err = response.ok === false ? response.error : null;
      reject(new Error(err?.message || 'Decode failed'));
    });

    const cmd: Command = {
      cmd: 'decode',
      id,
      file_id: fileId,
      frame,
      format: options?.format,
      scale: options?.scale,
      compression: options?.compression,
    };

    host.sendRaw(JSON.stringify(cmd)).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

export function prefetch(
  host: NativeHelperCommandHost,
  fileId: string,
  aroundFrame: number,
  radius = 50,
): void {
  if (!host.isConnected()) return;

  const cmd: Command = {
    cmd: 'prefetch',
    file_id: fileId,
    around_frame: aroundFrame,
    radius,
  };

  host.sendRaw(JSON.stringify(cmd)).catch(() => {
    // Ignore prefetch errors.
  });
}

export async function startEncode(
  host: NativeHelperCommandHost,
  output: EncodeOutput,
  frameCount: number,
): Promise<string> {
  const id = host.nextId();
  const response = await host.send({ cmd: 'start_encode', id, output, frame_count: frameCount });

  if (!response.ok) {
    throw new Error(getErrorMessage(response, 'Failed to start encode'));
  }

  return id;
}

export async function encodeFrame(
  host: NativeHelperCommandHost,
  encodeId: string,
  frameNum: number,
  frameData: Uint8Array,
): Promise<void> {
  const cmd: Command = {
    cmd: 'encode_frame',
    id: encodeId,
    frame_num: frameNum,
  };

  await host.sendRaw(JSON.stringify(cmd));
  await host.sendRaw(frameData);
}

export async function finishEncode(host: NativeHelperCommandHost, encodeId: string): Promise<string> {
  const response = await host.send({ cmd: 'finish_encode', id: encodeId });

  if (!response.ok) {
    throw new Error(getErrorMessage(response, 'Failed to finish encode'));
  }

  return okField<string>(response, 'output_path') ?? '';
}

export async function cancelEncode(host: NativeHelperCommandHost, encodeId: string): Promise<void> {
  await host.send({ cmd: 'cancel_encode', id: encodeId });
}

export async function closeFile(host: NativeHelperCommandHost, fileId: string): Promise<void> {
  const id = host.nextId();
  await host.send({ cmd: 'close', id, file_id: fileId });
}
