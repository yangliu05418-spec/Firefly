import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  canvasClipFieldCoverage,
  timelinePaintFacetKinds,
  timelinePaintResourceKinds,
} from '../../src/timeline/paint';

const repoRoot = process.cwd();
const canvasSourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'TimelineClipCanvas.tsx');
const paintSourceClipPath = path.join(repoRoot, 'src', 'timeline', 'paint', 'TimelinePaintSourceClip.ts');
const paintPacketPath = path.join(repoRoot, 'src', 'timeline', 'paint', 'TimelinePaintPacket.ts');
const workerPath = path.join(repoRoot, 'src', 'components', 'timeline', 'workers', 'timelineClipCanvas.worker.ts');
const workerPassivePainterPath = path.join(
  repoRoot,
  'src',
  'components',
  'timeline',
  'workers',
  'timelineClipCanvasWorkerPassivePainter.ts',
);
const workerModelPath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasWorkerModel.ts');
const compositionResourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasCompositionResource.ts');
const midiResourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasMidiResource.ts');
const passiveResourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasPassiveDecorations.ts');
const preparedResourcesPath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasPreparedResources.ts');
const spectrogramResourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasSpectrogramResource.ts');
const thumbnailPreparationPath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasThumbnailPreparation.ts');
const thumbnailResourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasThumbnailResource.ts');
const waveformResourcePath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasWaveformResource.ts');
const workerRuntimeHookPath = path.join(repoRoot, 'src', 'components', 'timeline', 'hooks', 'useTimelineClipCanvasWorkerRuntime.ts');
const paintVisualContributorsPath = path.join(repoRoot, 'src', 'components', 'timeline', 'utils', 'timelineClipCanvasPaintVisualContributors.ts');
const workerPaintClipAdapterPath = path.join(
  repoRoot,
  'src',
  'components',
  'timeline',
  'utils',
  'timelineClipCanvasWorkerPaintClip.ts',
);

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function typeLiteralMembers(typeNode: ts.TypeNode): readonly ts.PropertySignature[] {
  const candidates = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  return candidates
    .filter(ts.isTypeLiteralNode)
    .flatMap((candidate) => candidate.members.filter(ts.isPropertySignature));
}

function collectPaintSourceClipFields(): string[] {
  const source = readFileSync(paintSourceClipPath, 'utf8');
  const sourceFile = ts.createSourceFile(paintSourceClipPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fields = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'TimelinePaintSourceClip') {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = propertyName(member.name);
        if (!name) continue;
        fields.add(name);

        if (name === 'source' && member.type) {
          for (const nested of typeLiteralMembers(member.type)) {
            const nestedName = propertyName(nested.name);
            if (nestedName) fields.add(`source.${nestedName}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(fields).sort();
}

describe('timeline paint packet coverage', () => {
  it('keeps every TimelinePaintSourceClip field mapped to the target paint architecture', () => {
    const canvasFields = collectPaintSourceClipFields();
    const coveredFields = canvasClipFieldCoverage.map((entry) => entry.field).toSorted();

    expect(coveredFields).toEqual(canvasFields);
    expect(new Set(coveredFields).size).toBe(coveredFields.length);

    for (const entry of canvasClipFieldCoverage) {
      expect(entry.replacement, `${entry.field} needs a replacement target`).toBeTruthy();
      expect(entry.runtimeBoundary, `${entry.field} needs a runtime boundary`).toBeTruthy();
    }
  });

  it('keeps runtime-only fields out of the TimelinePaintSourceClip contract', () => {
    const runtimeOnlyFields = canvasClipFieldCoverage.filter((entry) => entry.runtimeBoundary === 'runtime-only');
    const paintSource = readFileSync(paintSourceClipPath, 'utf8');

    expect(runtimeOnlyFields).toEqual([]);
    expect(paintSource).not.toContain('file?: File');
  });

  it('deletes the former TimelineClipCanvasInputClip host bridge from the canvas host', () => {
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');

    expect(canvasSource).not.toContain('interface TimelineClipCanvasInputClip');
    expect(canvasSource).not.toContain('type TimelineClipCanvasInputClip');
    expect(canvasSource).toContain('TimelinePaintSourceClip');
  });

  it('defines paint facets and resources for the visual TimelinePaintSourceClip field groups', () => {
    expect(timelinePaintFacetKinds).toEqual([
      'body',
      'label',
      'thumbnail-strip',
      'waveform',
      'spectrogram',
      'midi-preview',
      'composition-visuals',
      'passive-decorations',
      'trim-visuals',
      'fade-visuals',
    ]);
    expect(timelinePaintResourceKinds).toContain('thumbnail-bitmap');
    expect(timelinePaintResourceKinds).toContain('waveform-columns');
    expect(timelinePaintResourceKinds).toContain('spectrogram-raster');
    expect(timelinePaintResourceKinds).toContain('midi-bars');
    expect(timelinePaintResourceKinds).toContain('analysis-overlay');
  });

  it('keeps the paint packet contract free of browser/runtime value handles', () => {
    const source = readFileSync(paintPacketPath, 'utf8');
    const bannedRuntimeTokens = [
      /\bFile\b/,
      /\bBlob\b/,
      /\bHTML(?:Video|Audio|Image|Canvas)Element\b/,
      /\bVideoFrame\b/,
      /\bAudioBuffer\b/,
      /\bImageBitmap\b/,
      /\bGPU(?:Texture|Buffer|Device)\b/,
      /\bMediaStream\b/,
      /\bOffscreenCanvas\b/,
      /\bURL\b/,
      /\bobjectURL\b/i,
      /\bblobUrl\b/i,
    ];

    for (const token of bannedRuntimeTokens) {
      expect(token.test(source), `paint packet contract contains runtime token ${token}`).toBe(false);
    }
  });

  it('makes the worker renderer consume paint packets for base clip geometry and state', () => {
    const source = readFileSync(workerPath, 'utf8');
    const passivePainterSource = readFileSync(workerPassivePainterPath, 'utf8');
    const workerModelSource = readFileSync(workerModelPath, 'utf8');
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');

    expect(source).toContain('clip.paintPacket.bodyRect.x');
    expect(source).toContain('clip.paintPacket.bodyRect.width');
    expect(source).toContain('clip.paintPacket.state.selected');
    expect(source).toContain('clip.paintPacket.state.hovered');
    expect(workerModelSource).toContain('label: input.clip.label');
    expect(canvasSource).toContain('createTimelineClipCanvasChromeOverlays');
    expect(source).toContain("workerClipPaintResourceId(clip, 'thumbnail-strip'");
    expect(source).toContain("workerClipHasPaintResource(clip, 'waveform'");
    expect(source).toContain("workerClipPaintResourceId(clip, 'spectrogram'");
    expect(source).toContain("workerClipPaintResourceId(clip, 'midi-preview'");
    expect(source).toContain("workerClipPaintFacet(clip, 'composition-visuals'");
    expect(source).toContain('drawWorkerPassiveDecorations(ctx, clip');
    expect(passivePainterSource).toContain("candidate.kind === 'passive-decorations'");
    expect(source).toContain("workerClipPaintFacet(clip, 'trim-visuals'");
    expect(source).toContain("workerClipPaintResourceId(clip, 'fade-visuals'");
    expect(source).not.toMatch(/\bclip\.(?:x|width|selected|hovered|name)\b/);
    expect(source).not.toContain('clip.passiveDecorations');
    expect(source).not.toContain('clip.compositionVisuals');
  });

  it('keeps raw host clip source fields out of the worker draw model boundary', () => {
    const modelSource = readFileSync(workerModelPath, 'utf8');
    const adapterSource = readFileSync(workerPaintClipAdapterPath, 'utf8');
    const contributorSource = readFileSync(paintVisualContributorsPath, 'utf8');
    const bannedWorkerModelReads = [
      'clip.source',
      'clip.trackType',
      'clip.waveform',
      'clip.waveformChannels',
      'clip.waveformGenerating',
      'clip.waveformProgress',
      'clip.audioState',
      'clip.midiData',
      'clip.fade',
      'clip.isComposition',
      'clip.compositionId',
      'clip.nestedClipBoundaries',
      'clip.clipSegments',
      'clip.mixdownWaveform',
      'clip.mixdownGenerating',
      'clip.hasMixdownAudio',
      'clip.thumbnails',
      'clip.mediaFileId',
      'clip.inPoint',
      'clip.outPoint',
      'clip.reversed',
      'clip.name',
    ];

    for (const fieldRead of bannedWorkerModelReads) {
      expect(modelSource, `worker model still reads raw host field ${fieldRead}`).not.toContain(fieldRead);
    }
    expect(adapterSource).toContain('createTimelineClipCanvasWorkerPaintClipInput');
    expect(adapterSource).toContain('TimelinePaintSourceClip');
    expect(adapterSource).toContain('resolveTimelineClipCanvasPaintVisuals');
    expect(adapterSource).not.toContain('TimelineClipCanvasWorkerSourceClip');
    expect(adapterSource).not.toContain("clip.source?.type === 'video'");
    expect(adapterSource).not.toContain("clip.source?.type === 'midi'");
    expect(contributorSource).toContain('timelineClipCanvasPaintVisualContributors');
    expect(contributorSource).toContain("id: 'thumbnail'");
    expect(contributorSource).toContain("id: 'midi-preview'");
  });

  it('keeps passive decoration worker resource building outside the canvas host', () => {
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');
    const passiveSource = readFileSync(passiveResourcePath, 'utf8');

    expect(passiveSource).toContain('createTimelineClipCanvasWorkerPassiveDecorationsResource');
    expect(canvasSource).not.toContain('function createWorkerPreparedPassiveDecorationsResource');
    expect(canvasSource).not.toContain('function createWorkerTranscriptMarkers');
    expect(canvasSource).not.toContain('function createWorkerAnalysisOverlay');
  });

  it('keeps composition visuals worker resource building outside the canvas host', () => {
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');
    const compositionSource = readFileSync(compositionResourcePath, 'utf8');

    expect(compositionSource).toContain('createTimelineClipCanvasWorkerCompositionVisualsResource');
    expect(canvasSource).not.toContain('function createWorkerPreparedCompositionVisualsResource');
    expect(canvasSource).not.toContain('function createWorkerCompositionSegmentRects');
    expect(canvasSource).not.toContain('function createWorkerCompositionNestedBoundaries');
    expect(canvasSource).not.toContain('function createWorkerCompositionSegmentThumbnailStripResource');
  });

  it('keeps thumbnail-strip worker resource building outside the canvas host', () => {
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');
    const thumbnailPreparationSource = readFileSync(thumbnailPreparationPath, 'utf8');
    const thumbnailSource = readFileSync(thumbnailResourcePath, 'utf8');
    const workerRuntimeSource = readFileSync(workerRuntimeHookPath, 'utf8');

    expect(thumbnailSource).toContain('createTimelineClipCanvasWorkerThumbnailResourcesByClipId');
    expect(thumbnailPreparationSource).toContain('plansByClipId');
    expect(workerRuntimeSource).toContain('createTimelineClipCanvasWorkerThumbnailResourcesByClipId');
    expect(workerRuntimeSource).toContain('workerThumbnailPreparation.plansByClipId');
    expect(canvasSource).toContain('collectTimelineClipCanvasWorkerThumbnailPreparation');
    expect(canvasSource).not.toContain('createTimelineClipCanvasWorkerThumbnailResourcesByClipId');
    expect(canvasSource).not.toContain('function createWorkerPreparedThumbnailStripResource');
    expect(canvasSource).not.toContain('function createWorkerPreparedThumbnailResourcesByClipId');
  });

  it('keeps audio and MIDI worker resource building outside the canvas host', () => {
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');
    const midiSource = readFileSync(midiResourcePath, 'utf8');
    const spectrogramSource = readFileSync(spectrogramResourcePath, 'utf8');
    const waveformSource = readFileSync(waveformResourcePath, 'utf8');

    expect(waveformSource).toContain('createTimelineClipCanvasWorkerWaveformResource');
    expect(spectrogramSource).toContain('createTimelineClipCanvasWorkerSpectrogramResource');
    expect(midiSource).toContain('createTimelineClipCanvasWorkerMidiPreviewResource');
    expect(canvasSource).not.toContain('function createWorkerPreparedWaveformResource');
    expect(canvasSource).not.toContain('function createWorkerPreparedSpectrogramResource');
    expect(canvasSource).not.toContain('function createCanvasMidiPreviewResource');
    expect(canvasSource).not.toContain('function resolveCanvasWaveformChannelIndexes');
    expect(canvasSource).not.toContain('function getWaveformPyramidForClip');
    expect(canvasSource).not.toContain('function getSpectrogramTileSetForClip');
    expect(canvasSource).not.toContain('function isCanvasMidiClip');
  });

  it('keeps worker prepared-resource composition outside the canvas host', () => {
    const canvasSource = readFileSync(canvasSourcePath, 'utf8');
    const preparedSource = readFileSync(preparedResourcesPath, 'utf8');

    expect(canvasSource).toContain('createTimelineClipCanvasWorkerPreparedResourcesByClipId');
    expect(preparedSource).toContain('createTimelineClipCanvasWorkerPreparedResourcesByClipId');
    expect(canvasSource).not.toContain('function createWorkerPreparedResourcesByClipId');
    expect(canvasSource).not.toContain('function createWorkerPreparedCompositionMixdownWaveformResource');
  });
});
