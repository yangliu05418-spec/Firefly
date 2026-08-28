import type { ExtensionProviderManifest } from '../../extensions';
import { normalizeSignalAsset } from '../../signals';
import {
  cloneArrayBuffer,
  createSignalArtifactId,
  getFileExtension,
  guessMimeType,
  uint8ArrayToArrayBuffer,
} from '../fileIdentity';
import {
  buildJsonSummaryMetadata,
  getJsonFormat,
  JSON_SUMMARY_FORMAT,
  type JsonSummary,
  summarizeJsonBytes,
} from '../json';
import { sha256ArrayBuffer } from '../hash';
import type {
  BuiltinSignalImportProvider,
  SignalImportArtifactPayload,
  SignalImportProviderResult,
  SignalImportRequest,
} from '../types';
import { builtinBinaryFallbackImporter } from './binaryFallbackImporter';

export const BUILTIN_JSON_IMPORTER_ID = 'masterselects.import.json';

export const builtinJsonImporterManifest: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: BUILTIN_JSON_IMPORTER_ID,
  version: '0.1.0',
  displayName: 'JSON Signal Importer',
  role: 'importer',
  runtime: 'builtin',
  capabilities: ['file.read', 'artifact.write'],
  fileSignatures: [
    { extensions: ['json', 'jsonl'] },
  ],
  signals: {
    outputKinds: ['metadata', 'binary'],
  },
  metadata: {
    importPriority: 95,
  },
};

function getJsonMimeType(file: File): string {
  return guessMimeType(file, getJsonFormat(file.name) === 'jsonl' ? 'application/x-ndjson' : 'application/json');
}

async function importAsBinaryFallback(
  request: SignalImportRequest,
  reason: unknown,
): Promise<SignalImportProviderResult> {
  const fallback = await builtinBinaryFallbackImporter.importFile(request);
  return {
    ...fallback,
    diagnostics: [
      {
        severity: 'warning',
        code: 'json.parse',
        message: `Could not parse "${request.file.name}" as JSON; imported via binary fallback.`,
        metadata: {
          reason: reason instanceof Error ? reason.message : String(reason),
        },
      },
      ...fallback.diagnostics,
    ],
  };
}

export const builtinJsonImporter: BuiltinSignalImportProvider = {
  manifest: builtinJsonImporterManifest,
  requiredCapabilities: ['file.read', 'artifact.write'],
  importFile: async (request) => {
    const { file, fileBytes, assetId, now, absolutePath } = request;
    let summary: JsonSummary;
    try {
      summary = summarizeJsonBytes(file.name, fileBytes);
    } catch (error) {
      return importAsBinaryFallback(request, error);
    }

    const createdAt = now();
    const mimeType = getJsonMimeType(file);
    const sourceHash = await sha256ArrayBuffer(fileBytes);
    const sourceArtifactId = createSignalArtifactId(assetId, 'source');
    const summaryArtifactId = createSignalArtifactId(assetId, 'json-summary');
    const summaryMetadata = buildJsonSummaryMetadata(summary);
    const summaryBytes = uint8ArrayToArrayBuffer(new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      format: JSON_SUMMARY_FORMAT,
      sourceFileName: file.name,
      ...summaryMetadata,
    }, null, 2)));
    const summaryHash = await sha256ArrayBuffer(summaryBytes);
    const metadataRefId = `${assetId}:metadata`;
    const binaryRefId = `${assetId}:binary`;

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
        providerId: BUILTIN_JSON_IMPORTER_ID,
      },
      refs: [
        {
          id: metadataRefId,
          kind: 'metadata',
          artifactId: summaryArtifactId,
          mimeType: 'application/json',
          metadata: summaryMetadata,
        },
        {
          id: binaryRefId,
          kind: 'binary',
          artifactId: sourceArtifactId,
          mimeType,
          metadata: {
            byteLength: fileBytes.byteLength,
            mimeType,
          },
        },
      ],
      artifacts: [
        {
          artifactId: sourceArtifactId,
          hash: sourceHash,
          size: fileBytes.byteLength,
          mimeType,
          encoding: summary.format === 'json' ? 'json' : 'text',
          storage: { kind: 'memory' },
          producer: {
            providerId: BUILTIN_JSON_IMPORTER_ID,
            providerVersion: builtinJsonImporterManifest.version,
          },
          sourceRefs: [binaryRefId],
          createdAt,
          metadata: {
            role: 'source',
            fileName: file.name,
            lastModified: file.lastModified,
            format: summary.format,
          },
        },
        {
          artifactId: summaryArtifactId,
          hash: summaryHash,
          size: summaryBytes.byteLength,
          mimeType: 'application/json',
          encoding: 'json',
          storage: { kind: 'memory' },
          producer: {
            providerId: BUILTIN_JSON_IMPORTER_ID,
            providerVersion: builtinJsonImporterManifest.version,
          },
          sourceRefs: [metadataRefId, binaryRefId],
          createdAt,
          metadata: {
            role: 'json-summary',
            sourceArtifactId,
            ...summaryMetadata,
          },
        },
      ],
      createdAt,
      metadata: {
        importerRoute: 'signal',
        providerId: BUILTIN_JSON_IMPORTER_ID,
        ...summaryMetadata,
      },
    }, { now });

    const artifactPayloads: SignalImportArtifactPayload[] = asset.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      fileName: file.name,
      mimeType: artifact.mimeType,
      bytes: artifact.artifactId === summaryArtifactId ? cloneArrayBuffer(summaryBytes) : cloneArrayBuffer(fileBytes),
      artifact,
    }));

    return {
      asset,
      artifactPayloads,
      diagnostics: summary.diagnostics.map((message) => ({
        severity: 'warning',
        code: 'json.summary',
        message,
      })),
    };
  },
};
