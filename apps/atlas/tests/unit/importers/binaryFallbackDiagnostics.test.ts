import { describe, expect, it } from 'vitest';
import {
  BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
  createDefaultUniversalImportOrchestrator,
} from '../../../src/importers';
import { createSignalTimelineRenderPlan } from '../../../src/runtime/renderers/signalTextRendererAdapter';
import type { SignalAssetItem } from '../../../src/stores/mediaStore';

const fixedNow = () => '2026-06-09T00:00:00.000Z';

describe('binary fallback diagnostics', () => {
  it('captures signature, hex, and ASCII preview metadata for unknown binary files', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({
      now: fixedNow,
      legacyClassifier: async () => 'unknown',
    });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const file = new File([bytes], 'manual.zzz', { type: '' });

    const result = await orchestrator.importFile(file);

    expect(result.route).toBe('signal');
    if (result.route !== 'signal') throw new Error('Expected signal import');

    expect(result.provider.id).toBe(BUILTIN_BINARY_FALLBACK_IMPORTER_ID);
    const binaryRef = result.asset.refs.find((ref) => ref.kind === 'binary');
    expect(binaryRef?.metadata).toMatchObject({
      byteLength: 8,
      mimeType: 'application/octet-stream',
      sniffedMimeType: 'application/pdf',
      signature: 'PDF',
      headerHex: '25 50 44 46 2d 31 2e 37',
      headerAscii: '%PDF-1.7',
      previewByteCount: 8,
    });

    const item: SignalAssetItem = {
      id: result.asset.id,
      name: result.asset.name,
      type: 'signal',
      parentId: null,
      createdAt: Date.parse(fixedNow()),
      asset: result.asset,
      artifacts: result.asset.artifacts,
      signalKinds: result.asset.refs.map((ref) => ref.kind),
      providerId: result.asset.source.providerId,
      fileSize: bytes.byteLength,
      fileHash: result.asset.source.hash,
      diagnostics: result.diagnostics,
    };
    const plan = createSignalTimelineRenderPlan(item);

    expect(plan.textProperties.text).toContain('Binary Signal');
    expect(plan.textProperties.text).toContain('MIME application/octet-stream');
    expect(plan.textProperties.text).toContain('Sniffed application/pdf');
    expect(plan.textProperties.text).toContain('Signature PDF');
    expect(plan.textProperties.text).toContain('Hex 25 50 44 46 2d 31 2e 37');
    expect(plan.textProperties.text).toContain('ASCII %PDF-1.7');
  });
});
