import { describe, expect, it } from 'vitest';
import {
  BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
  BUILTIN_JSON_IMPORTER_ID,
  createDefaultUniversalImportOrchestrator,
} from '../../../src/importers';

const fixedNow = () => '2026-06-09T00:00:00.000Z';

function textFromPayload(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(bytes);
}

describe('JSON signal import', () => {
  it('imports JSON files as structured SignalAsset summaries', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({
      now: fixedNow,
      legacyClassifier: async () => 'unknown',
    });
    const file = new File([
      JSON.stringify({
        name: 'Demo',
        version: 1,
        project: {
          tracks: [{ id: 'v1', enabled: true }],
          tags: ['signal', 'json'],
        },
      }),
    ], 'DATA.JSON', { type: 'application/json' });

    const result = await orchestrator.importFile(file);

    expect(result.route).toBe('signal');
    if (result.route !== 'signal') throw new Error('Expected signal import');

    expect(result.provider.id).toBe(BUILTIN_JSON_IMPORTER_ID);
    expect(result.discovery.discoveredProviders.map((provider) => provider.id)).toEqual([
      BUILTIN_JSON_IMPORTER_ID,
      BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
    ]);
    expect(result.asset).toMatchObject({
      name: 'DATA.JSON',
      source: {
        extension: 'json',
        mimeType: 'application/json',
        providerId: BUILTIN_JSON_IMPORTER_ID,
      },
      metadata: {
        importerRoute: 'signal',
        providerId: BUILTIN_JSON_IMPORTER_ID,
        format: 'json',
        topLevelType: 'object',
        keyCount: 3,
        truncated: false,
        parseMode: 'full',
      },
    });
    expect(result.asset.refs.map((ref) => ref.kind).toSorted()).toEqual(['binary', 'metadata']);
    expect(result.asset.artifacts.map((artifact) => artifact.encoding).toSorted()).toEqual(['json', 'json']);

    const summaryRef = result.asset.refs.find((ref) => ref.kind === 'metadata');
    expect(summaryRef?.metadata).toMatchObject({
      summaryFormat: 'masterselects.json-summary',
      topLevelType: 'object',
      keyCount: 3,
      valueTypeHistogram: expect.objectContaining({
        object: expect.any(Number),
        array: expect.any(Number),
        string: expect.any(Number),
        number: expect.any(Number),
        boolean: expect.any(Number),
      }),
    });

    const summaryPayload = result.artifactPayloads.find((payload) => payload.artifact.metadata?.role === 'json-summary');
    expect(summaryPayload).toBeDefined();
    expect(JSON.parse(textFromPayload(summaryPayload!.bytes))).toMatchObject({
      format: 'json',
      sourceFileName: 'DATA.JSON',
      topLevelType: 'object',
      keyCount: 3,
    });
  });

  it('imports JSONL files as record-sequence summaries', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({
      now: fixedNow,
      legacyClassifier: async () => 'unknown',
    });
    const file = new File([
      '{"id":1,"ok":true}\n{"id":2,"label":"next"}\n',
    ], 'events.jsonl', { type: '' });

    const result = await orchestrator.importFile(file);

    expect(result.route).toBe('signal');
    if (result.route !== 'signal') throw new Error('Expected signal import');

    expect(result.provider.id).toBe(BUILTIN_JSON_IMPORTER_ID);
    expect(result.asset.source.mimeType).toBe('application/x-ndjson');
    expect(result.asset.metadata).toMatchObject({
      format: 'jsonl',
      topLevelType: 'jsonl',
      arrayLength: 2,
      keyCount: 2,
      truncated: false,
    });
    expect(result.asset.artifacts.find((artifact) => artifact.metadata?.role === 'source')).toMatchObject({
      encoding: 'text',
      mimeType: 'application/x-ndjson',
    });
  });

  it('falls back to binary SignalAsset import when JSON parsing fails', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({
      now: fixedNow,
      legacyClassifier: async () => 'unknown',
    });
    const file = new File(['{ broken json'], 'broken.json', { type: '' });

    const result = await orchestrator.importFile(file);

    expect(result.route).toBe('signal');
    if (result.route !== 'signal') throw new Error('Expected signal import');

    expect(result.discovery.discoveredProviders.map((provider) => provider.id)).toEqual([
      BUILTIN_JSON_IMPORTER_ID,
      BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
    ]);
    expect(result.provider.id).toBe(BUILTIN_BINARY_FALLBACK_IMPORTER_ID);
    expect(result.asset.source.providerId).toBe(BUILTIN_BINARY_FALLBACK_IMPORTER_ID);
    expect(result.asset.metadata).toMatchObject({
      importerRoute: 'binary-fallback',
      providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
    });
    expect(result.asset.refs.map((ref) => ref.kind).toSorted()).toEqual(['binary', 'metadata']);
    expect(result.asset.refs.find((ref) => ref.kind === 'binary')?.metadata).toMatchObject({
      byteLength: 13,
      mimeType: 'application/json',
      headerAscii: '{ broken json',
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'json.parse',
      'binary.fallback',
    ]);
  });
});
