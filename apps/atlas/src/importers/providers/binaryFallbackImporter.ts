import type { ExtensionProviderManifest } from '../../extensions';
import { normalizeSignalAsset, type SignalMetadata } from '../../signals';
import { cloneArrayBuffer, createSignalArtifactId, getFileExtension, guessMimeType } from '../fileIdentity';
import type { BuiltinSignalImportProvider } from '../types';
import { sha256ArrayBuffer } from '../hash';

export const BUILTIN_BINARY_FALLBACK_IMPORTER_ID = 'masterselects.import.binary-fallback';

export const builtinBinaryFallbackImporterManifest: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
  version: '0.1.0',
  displayName: 'Binary Fallback Importer',
  role: 'importer',
  runtime: 'builtin',
  capabilities: ['file.read', 'artifact.write'],
  fileSignatures: [
    {},
  ],
  signals: {
    outputKinds: ['binary', 'metadata'],
  },
  metadata: {
    fallback: true,
    importPriority: -1000,
  },
};

const BINARY_PREVIEW_BYTES = 32;

function getPreviewBytes(fileBytes: ArrayBuffer, header: Uint8Array): Uint8Array {
  if (header.byteLength > 0) return header.slice(0, BINARY_PREVIEW_BYTES);
  return new Uint8Array(fileBytes, 0, Math.min(fileBytes.byteLength, BINARY_PREVIEW_BYTES));
}

function bytesToSpacedHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

function bytesToAsciiPreview(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('');
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.byteLength >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  return bytesToAsciiPreview(bytes.slice(start, end));
}

function sniffBinarySignature(bytes: Uint8Array): { signature?: string; sniffedMimeType?: string } {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { signature: 'PDF', sniffedMimeType: 'application/pdf' };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { signature: 'PNG', sniffedMimeType: 'image/png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { signature: 'JPEG', sniffedMimeType: 'image/jpeg' };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { signature: 'GIF', sniffedMimeType: 'image/gif' };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return { signature: 'ZIP', sniffedMimeType: 'application/zip' };
  }
  if (startsWith(bytes, [0x1f, 0x8b])) {
    return { signature: 'GZIP', sniffedMimeType: 'application/gzip' };
  }
  if (startsWith(bytes, [0x67, 0x6c, 0x54, 0x46])) {
    return { signature: 'GLB', sniffedMimeType: 'model/gltf-binary' };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.byteLength >= 12) {
    const subtype = readAscii(bytes, 8, 12);
    if (subtype === 'WAVE') return { signature: 'RIFF/WAVE', sniffedMimeType: 'audio/wav' };
    if (subtype === 'WEBP') return { signature: 'RIFF/WEBP', sniffedMimeType: 'image/webp' };
    if (subtype === 'AVI ') return { signature: 'RIFF/AVI', sniffedMimeType: 'video/x-msvideo' };
    return { signature: `RIFF/${subtype}` };
  }
  return {};
}

export const builtinBinaryFallbackImporter: BuiltinSignalImportProvider = {
  manifest: builtinBinaryFallbackImporterManifest,
  requiredCapabilities: ['file.read', 'artifact.write'],
  importFile: async ({ file, fileBytes, header, assetId, now, absolutePath }) => {
    const createdAt = now();
    const mimeType = guessMimeType(file);
    const sourceHash = await sha256ArrayBuffer(fileBytes);
    const sourceArtifactId = createSignalArtifactId(assetId, 'source');
    const binaryRefId = `${assetId}:binary`;
    const metadataRefId = `${assetId}:metadata`;
    const previewBytes = getPreviewBytes(fileBytes, header);
    const signature = sniffBinarySignature(previewBytes);
    const diagnosticMetadata: SignalMetadata = {
      byteLength: fileBytes.byteLength,
      mimeType,
      headerHex: bytesToSpacedHex(previewBytes),
      headerAscii: bytesToAsciiPreview(previewBytes),
      previewByteCount: previewBytes.byteLength,
    };
    if (signature.sniffedMimeType) diagnosticMetadata.sniffedMimeType = signature.sniffedMimeType;
    if (signature.signature) diagnosticMetadata.signature = signature.signature;

    const asset = normalizeSignalAsset({
      id: assetId,
      name: file.name,
      source: {
        kind: 'file',
        fileName: file.name,
        extension: getFileExtension(file.name),
        mimeType,
        size: file.size,
        hash: sourceHash,
        absolutePath,
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
      refs: [
        {
          id: binaryRefId,
          kind: 'binary',
          artifactId: sourceArtifactId,
          mimeType,
          metadata: diagnosticMetadata,
        },
        {
          id: metadataRefId,
          kind: 'metadata',
          metadata: {
            sourceArtifactId,
            extension: getFileExtension(file.name),
            fallback: true,
            ...diagnosticMetadata,
          },
        },
      ],
      artifacts: [
        {
          artifactId: sourceArtifactId,
          hash: sourceHash,
          size: fileBytes.byteLength,
          mimeType,
          encoding: 'raw',
          storage: { kind: 'memory' },
          producer: {
            providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
            providerVersion: builtinBinaryFallbackImporterManifest.version,
          },
          sourceRefs: [binaryRefId],
          createdAt,
          metadata: {
            role: 'source',
            fallback: true,
            fileName: file.name,
            lastModified: file.lastModified,
            ...diagnosticMetadata,
          },
        },
      ],
      createdAt,
      metadata: {
        importerRoute: 'binary-fallback',
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
    }, { now });

    return {
      asset,
      artifactPayloads: [
        {
          artifactId: sourceArtifactId,
          fileName: file.name,
          mimeType,
          bytes: cloneArrayBuffer(fileBytes),
          artifact: asset.artifacts[0]!,
        },
      ],
      diagnostics: [
        {
          severity: 'info',
          code: 'binary.fallback',
          message: `Imported "${file.name}" as a binary SignalAsset.`,
          metadata: diagnosticMetadata,
        },
      ],
    };
  },
};
