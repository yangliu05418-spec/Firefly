// riveSettingsMapping - Pure settings → runtime-parameter mapping for the Rive runtime.
// Moved from RiveRuntimeManager: layout/fit mapping, cache keys, render-size and
// animation/view-model selection from prepared-asset metadata, color parsing, and
// prepare-promise key derivation. No runtime handles; canvas/player ownership stays
// in RiveRuntimeManager.

import { Alignment, Fit, Layout } from '@rive-app/canvas';

import type { TimelineClip } from '../../../types';
import {
  normalizeVectorAnimationRenderDimension,
  normalizeVectorAnimationStateName,
  type VectorAnimationClipSettings,
  type VectorAnimationDataBindingProperty,
} from '../../../types/vectorAnimation';
import type { PreparedRiveAsset } from '../types';
import type { VectorRuntimePrepareOptions } from '../vectorRuntimeReporting';

export const DEFAULT_CANVAS_SIZE = 512;

type PreparedRiveMetadata = PreparedRiveAsset['metadata'];

function getFit(settings: VectorAnimationClipSettings): Fit {
  if (settings.fit === 'cover') return Fit.Cover;
  if (settings.fit === 'fill') return Fit.Fill;
  return Fit.Contain;
}

export function createLayout(settings: VectorAnimationClipSettings): Layout {
  return new Layout({
    fit: getFit(settings),
    alignment: Alignment.Center,
  });
}

export function getSettingsKey(settings: VectorAnimationClipSettings): string {
  return JSON.stringify({
    backgroundColor: settings.backgroundColor ?? null,
    fit: settings.fit,
    loop: settings.loop,
    endBehavior: settings.endBehavior,
    playbackMode: settings.playbackMode,
    renderWidth: settings.renderWidth ?? null,
    renderHeight: settings.renderHeight ?? null,
  });
}

export function getInstanceKey(settings: VectorAnimationClipSettings): string {
  return JSON.stringify({
    animationName: settings.animationName ?? null,
    artboard: settings.artboard ?? null,
    stateMachineName: settings.stateMachineName ?? null,
    viewModelName: settings.viewModelName ?? null,
    viewModelInstanceName: settings.viewModelInstanceName ?? null,
  });
}

export function getRenderSize(
  metadata: PreparedRiveMetadata,
  settings: VectorAnimationClipSettings,
): { width: number; height: number } {
  const width = normalizeVectorAnimationRenderDimension(settings.renderWidth)
    ?? metadata.width
    ?? DEFAULT_CANVAS_SIZE;
  const height = normalizeVectorAnimationRenderDimension(settings.renderHeight)
    ?? metadata.height
    ?? DEFAULT_CANVAS_SIZE;
  return { width, height };
}

export function getSelectedAnimationName(
  metadata: PreparedRiveMetadata,
  settings: VectorAnimationClipSettings,
): string | undefined {
  return (
    normalizeVectorAnimationStateName(settings.animationName) ??
    metadata.defaultAnimationName ??
    metadata.animationNames?.[0]
  );
}

export function parseRiveColorValue(value: string | number | boolean): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'boolean') {
    return value ? 0xffffffff : 0xff000000;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    const rgb = Number.parseInt(trimmed.slice(1), 16);
    return 0xff000000 | rgb;
  }
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(1), 16);
  }
  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue) ? Math.round(numericValue) : null;
}

export function getDataBindingPropertiesForSettings(
  metadata: PreparedRiveMetadata,
  settings: VectorAnimationClipSettings,
): VectorAnimationDataBindingProperty[] {
  const viewModelName = settings.viewModelName ?? metadata.defaultViewModelName;
  const properties = metadata.dataBindingProperties ?? [];
  return viewModelName
    ? properties.filter((property) => property.viewModelName === viewModelName)
    : properties;
}

const rivePrepareFileIds = new WeakMap<File, number>();
let nextRivePrepareFileId = 1;

function getPrepareFileKey(file: File | undefined): string {
  if (!file) {
    return 'none';
  }

  let id = rivePrepareFileIds.get(file);
  if (!id) {
    id = nextRivePrepareFileId;
    nextRivePrepareFileId += 1;
    rivePrepareFileIds.set(file, id);
  }

  return `${id}:${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function getPrepareRuntimeOptionsKey(options?: VectorRuntimePrepareOptions): string {
  if (!options) {
    return 'default';
  }
  return [
    options.policyId ?? 'interactive',
    options.ownerId ?? 'default-owner',
    options.resourceId ?? 'default-resource',
  ].join(':');
}

export function getPreparePromiseKey(
  clip: TimelineClip,
  fileOverride?: File,
  runtimeOptions?: VectorRuntimePrepareOptions,
): string {
  return `${clip.id}:${getPrepareFileKey(fileOverride ?? clip.file)}:${getPrepareRuntimeOptionsKey(runtimeOptions)}`;
}
