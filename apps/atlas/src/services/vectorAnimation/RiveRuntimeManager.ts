import {
  EventType,
  Rive,
  StateMachineInputType,
  type AssetLoadCallback,
  type Event as RiveRuntimeEvent,
  type StateMachineInput,
  type ViewModelInstance,
} from '@rive-app/canvas';

import type { TimelineClip } from '../../types';
import {
  coerceVectorAnimationDataBindingValue,
  coerceVectorAnimationInputValue,
  getVectorAnimationDataBindingDefaultValue,
  getVectorAnimationInputDefaultValue,
  mergeVectorAnimationSettings,
  normalizeVectorAnimationStateName,
  type VectorAnimationClipSettings,
} from '../../types/vectorAnimation';
import { Logger } from '../logger';
import { prepareRiveAsset } from './riveMetadata';
import { resolveAnimationTime } from './riveRuntime/rivePlaybackPlanning';
import {
  createLayout,
  DEFAULT_CANVAS_SIZE,
  getDataBindingPropertiesForSettings,
  getInstanceKey,
  getPreparePromiseKey,
  getRenderSize,
  getSelectedAnimationName,
  getSettingsKey,
  parseRiveColorValue,
} from './riveRuntime/riveSettingsMapping';
import type {
  PreparedRiveAsset,
  RiveRuntimePrepareResult,
} from './types';
import {
  createVectorRuntimeAdmissionError,
  reserveVectorRuntimeCanvasResource,
  type VectorRuntimePrepareOptions,
} from './vectorRuntimeReporting';

const log = Logger.create('RiveRuntime');
const DEFAULT_RIVE_DURATION = 5;

interface RiveRuntimeEntry {
  asset: PreparedRiveAsset;
  canvas: HTMLCanvasElement;
  clipId: string;
  isReady: boolean;
  player: Rive;
  releaseRuntimeResource?: () => void;
  runtimeResourceId?: string;
  settingsKey: string;
  instanceKey: string;
  activeStateMachineName?: string;
  stateMachineInputs: Map<string, StateMachineInput>;
  lastInputValuesKey?: string;
  lastTriggerValuesKey?: string;
  boundViewModelKey?: string;
  viewModelInstance?: ViewModelInstance;
  lastDataBindingValuesKey?: string;
  lastDataBindingTriggerKey?: string;
  riveEventHandler: (event: RiveRuntimeEvent) => void;
}

function createCanvas(width?: number, height?: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width && width > 0 ? width : DEFAULT_CANVAS_SIZE;
  canvas.height = height && height > 0 ? height : DEFAULT_CANVAS_SIZE;
  canvas.dataset.masterselectsDynamic = 'rive';
  return canvas;
}

function waitForRiveLoad(params: ConstructorParameters<typeof Rive>[0]): Promise<Rive> {
  let player: Rive | null = null;

  return new Promise<Rive>((resolve, reject) => {
    try {
      player = new Rive({
        ...params,
        onLoad: () => {
          if (player) {
            resolve(player);
          }
        },
        onLoadError: (event) => {
          reject(event.data instanceof Error ? event.data : new Error('Failed to load Rive runtime'));
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}

function createAssetLoader(clipId: string): AssetLoadCallback {
  return (_asset, bytes) => {
    log.debug('Rive asset requested', { clipId, byteLength: bytes.byteLength });
    return false;
  };
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

export class RiveRuntimeManager {
  private entries = new Map<string, RiveRuntimeEntry>();
  private preparePromises = new Map<string, Promise<RiveRuntimePrepareResult>>();

  async prepareClipSource(
    clip: TimelineClip,
    fileOverride?: File,
    runtimeOptions?: VectorRuntimePrepareOptions,
  ): Promise<RiveRuntimePrepareResult> {
    if (clip.source?.type !== 'rive') {
      throw new Error(`prepareClipSource called for non-Rive clip ${clip.id}`);
    }

    const preparePromiseKey = getPreparePromiseKey(clip, fileOverride, runtimeOptions);
    const existingPromise = this.preparePromises.get(preparePromiseKey);
    if (existingPromise) {
      return existingPromise;
    }

    const preparePromise = this.prepareClipSourceInternal(clip, fileOverride, runtimeOptions).finally(() => {
      this.preparePromises.delete(preparePromiseKey);
    });

    this.preparePromises.set(preparePromiseKey, preparePromise);
    return preparePromise;
  }

  private async prepareClipSourceInternal(
    clip: TimelineClip,
    fileOverride?: File,
    runtimeOptions?: VectorRuntimePrepareOptions,
  ): Promise<RiveRuntimePrepareResult> {
    const file = fileOverride ?? clip.file;
    if (!file) {
      throw new Error(`Missing file for Rive clip ${clip.id}`);
    }

    const asset = await prepareRiveAsset(file);
    const existing = this.entries.get(clip.id);
    if (existing && existing.asset.payload.sourceKey === asset.payload.sourceKey) {
      this.applySettings(existing, clip);
      return {
        canvas: existing.canvas,
        metadata: existing.asset.metadata,
      };
    }

    if (existing) {
      this.destroyClipRuntime(clip.id);
    }

    const settings = mergeVectorAnimationSettings(clip.source?.vectorAnimationSettings);
    const reservation = reserveVectorRuntimeCanvasResource({
      clip,
      provider: 'rive',
      width: asset.metadata.width,
      height: asset.metadata.height,
      options: runtimeOptions,
    });
    if (!reservation.admitted) {
      throw createVectorRuntimeAdmissionError({
        clip,
        provider: 'rive',
        decision: reservation.decision,
      });
    }

    const canvas = createCanvas(asset.metadata.width, asset.metadata.height);
    let player: Rive;
    try {
      player = await waitForRiveLoad({
        canvas,
        buffer: asset.payload.data.slice(0),
        artboard: settings.artboard,
        animations: getSelectedAnimationName(asset.metadata, settings),
        stateMachines: normalizeVectorAnimationStateName(settings.stateMachineName),
        layout: createLayout(settings),
        autoplay: false,
        autoBind: false,
        enableRiveAssetCDN: true,
        shouldDisableRiveListeners: true,
        automaticallyHandleEvents: false,
        assetLoader: createAssetLoader(clip.id),
      });

      player.pause();
    } catch (error) {
      reservation.release();
      throw error;
    }

    const entry: RiveRuntimeEntry = {
      asset,
      canvas,
      clipId: clip.id,
      isReady: true,
      player,
      releaseRuntimeResource: reservation.release,
      runtimeResourceId: reservation.resourceId,
      settingsKey: '',
      instanceKey: '',
      stateMachineInputs: new Map(),
      riveEventHandler: (event) => {
        log.debug('Rive event', { clipId: clip.id, data: event.data });
      },
    };
    player.on(EventType.RiveEvent, entry.riveEventHandler);

    this.applySettings(entry, clip);
    this.entries.set(clip.id, entry);

    return {
      canvas,
      metadata: asset.metadata,
    };
  }

  private applySettings(
    entry: RiveRuntimeEntry,
    clip: TimelineClip,
    settingsOverride?: VectorAnimationClipSettings,
  ): void {
    const settings = mergeVectorAnimationSettings(settingsOverride ?? clip.source?.vectorAnimationSettings);
    const settingsKey = getSettingsKey(settings);
    const instanceKey = getInstanceKey(settings);

    if (instanceKey !== entry.instanceKey) {
      this.resetRiveInstance(entry, clip.id, settings, instanceKey);
    }

    if (settingsKey === entry.settingsKey) {
      return;
    }

    const renderSize = getRenderSize(entry.asset.metadata, settings);
    if (entry.canvas.width !== renderSize.width || entry.canvas.height !== renderSize.height) {
      entry.canvas.width = renderSize.width;
      entry.canvas.height = renderSize.height;
    }

    entry.player.layout = createLayout(settings);
    entry.player.resizeToCanvas();
    entry.settingsKey = settingsKey;
  }

  private resetRiveInstance(
    entry: RiveRuntimeEntry,
    clipId: string,
    settings: VectorAnimationClipSettings,
    instanceKey: string,
  ): void {
    try {
      entry.player.reset({
        artboard: settings.artboard,
        animations: getSelectedAnimationName(entry.asset.metadata, settings),
        stateMachines: normalizeVectorAnimationStateName(settings.stateMachineName),
        autoplay: false,
        autoBind: false,
      });
      entry.player.pause();
      entry.activeStateMachineName = normalizeVectorAnimationStateName(settings.stateMachineName);
      entry.stateMachineInputs = new Map(
        entry.activeStateMachineName
          ? entry.player.stateMachineInputs(entry.activeStateMachineName).map((input) => [input.name, input])
          : [],
      );
      entry.lastInputValuesKey = undefined;
      entry.lastTriggerValuesKey = undefined;
      entry.lastDataBindingValuesKey = undefined;
      entry.lastDataBindingTriggerKey = undefined;
      entry.instanceKey = instanceKey;
      this.resetViewModelBinding(entry);
      this.applyDataBindingSelection(entry, settings);
    } catch (error) {
      log.warn('Failed to reset Rive instance', { clipId, error });
    }
  }

  private resetViewModelBinding(entry: RiveRuntimeEntry): void {
    if (entry.viewModelInstance) {
      try {
        entry.player.bindViewModelInstance(null);
        entry.viewModelInstance.cleanup();
      } catch (error) {
        log.debug('Failed to cleanup Rive view model instance', { clipId: entry.clipId, error });
      }
    }

    entry.viewModelInstance = undefined;
    entry.boundViewModelKey = undefined;
  }

  private applyDataBindingSelection(
    entry: RiveRuntimeEntry,
    settings: VectorAnimationClipSettings,
  ): void {
    const hasBindingValues = Object.keys(settings.dataBindingValues ?? {}).length > 0;
    const viewModelName = settings.viewModelName ?? (hasBindingValues ? entry.asset.metadata.defaultViewModelName : undefined);
    if (!viewModelName) {
      return;
    }

    const key = `${viewModelName}:${settings.viewModelInstanceName ?? ''}`;
    if (entry.boundViewModelKey === key && entry.viewModelInstance) {
      return;
    }

    this.resetViewModelBinding(entry);

    try {
      const viewModel = entry.player.viewModelByName(viewModelName) ?? entry.player.defaultViewModel();
      if (!viewModel) {
        return;
      }

      const instance = settings.viewModelInstanceName
        ? viewModel.instanceByName(settings.viewModelInstanceName)
        : viewModel.defaultInstance() ?? viewModel.instance();
      if (!instance) {
        return;
      }

      entry.player.bindViewModelInstance(instance);
      entry.viewModelInstance = instance;
      entry.boundViewModelKey = key;
    } catch (error) {
      log.warn('Failed to bind Rive view model', { clipId: entry.clipId, viewModelName, error });
    }
  }

  private applyStateMachineInputs(
    entry: RiveRuntimeEntry,
    clipId: string,
    settings: VectorAnimationClipSettings,
  ): void {
    const stateMachineName = normalizeVectorAnimationStateName(settings.stateMachineName);
    if (!stateMachineName || entry.stateMachineInputs.size === 0) {
      return;
    }

    const metadataInputs = entry.asset.metadata.stateMachineInputs?.[stateMachineName] ?? [];
    if (metadataInputs.length === 0) {
      return;
    }

    const values = metadataInputs.map((input) => ({
      input,
      value: coerceVectorAnimationInputValue(
        input,
        settings.stateMachineInputValues?.[input.name] ?? getVectorAnimationInputDefaultValue(input),
      ),
    }));
    const valueKey = JSON.stringify(values.map(({ input, value }) => [stateMachineName, input.name, input.type, value]));
    const triggerKey = JSON.stringify(values
      .filter(({ input, value }) => input.type === 'trigger' && Boolean(value))
      .map(({ input, value }) => [stateMachineName, input.name, value]));

    if (entry.lastInputValuesKey === valueKey && entry.lastTriggerValuesKey === triggerKey) {
      return;
    }

    for (const { input, value } of values) {
      const runtimeInput = entry.stateMachineInputs.get(input.name);
      if (!runtimeInput) {
        continue;
      }

      try {
        if (runtimeInput.type === StateMachineInputType.Boolean) {
          runtimeInput.value = Boolean(value);
        } else if (runtimeInput.type === StateMachineInputType.Number) {
          const numericValue = typeof value === 'number' ? value : Number(value);
          if (Number.isFinite(numericValue)) {
            runtimeInput.value = numericValue;
          }
        } else if (
          runtimeInput.type === StateMachineInputType.Trigger &&
          Boolean(value) &&
          entry.lastTriggerValuesKey !== triggerKey
        ) {
          runtimeInput.fire();
        }
      } catch (error) {
        log.warn('Failed to apply Rive state machine input', {
          clipId,
          stateMachineName,
          inputName: input.name,
          error,
        });
      }
    }

    entry.lastInputValuesKey = valueKey;
    entry.lastTriggerValuesKey = triggerKey;
  }

  private applyDataBindingValues(
    entry: RiveRuntimeEntry,
    settings: VectorAnimationClipSettings,
  ): void {
    const values = settings.dataBindingValues ?? {};
    if (Object.keys(values).length === 0) {
      return;
    }

    this.applyDataBindingSelection(entry, settings);
    const instance = entry.viewModelInstance;
    if (!instance) {
      return;
    }

    const properties = getDataBindingPropertiesForSettings(entry.asset.metadata, settings);
    const valueKey = JSON.stringify(properties.map((property) => [
      property.viewModelName,
      property.name,
      property.type,
      values[property.name] ?? property.defaultValue ?? null,
    ]));
    const triggerKey = JSON.stringify(properties
      .filter((property) => property.type === 'trigger' && Boolean(values[property.name]))
      .map((property) => [property.viewModelName, property.name, values[property.name]]));

    if (entry.lastDataBindingValuesKey === valueKey && entry.lastDataBindingTriggerKey === triggerKey) {
      return;
    }

    for (const property of properties) {
      const value = coerceVectorAnimationDataBindingValue(
        property,
        values[property.name] ?? getVectorAnimationDataBindingDefaultValue(property),
      );

      try {
        if (property.type === 'boolean') {
          const binding = instance.boolean(property.name);
          if (binding) binding.value = Boolean(value);
        } else if (property.type === 'number' || property.type === 'integer') {
          const binding = instance.number(property.name);
          const numericValue = typeof value === 'number' ? value : Number(value);
          if (binding && Number.isFinite(numericValue)) binding.value = numericValue;
        } else if (property.type === 'string') {
          const binding = instance.string(property.name);
          if (binding) binding.value = String(value);
        } else if (property.type === 'enum') {
          const binding = instance.enum(property.name);
          if (binding) binding.value = String(value);
        } else if (property.type === 'color') {
          const binding = instance.color(property.name);
          const colorValue = parseRiveColorValue(value);
          if (binding && colorValue !== null) binding.value = colorValue;
        } else if (
          property.type === 'trigger' &&
          Boolean(value) &&
          entry.lastDataBindingTriggerKey !== triggerKey
        ) {
          instance.trigger(property.name)?.trigger();
        }
      } catch (error) {
        log.warn('Failed to apply Rive data binding', {
          clipId: entry.clipId,
          propertyName: property.name,
          type: property.type,
          error,
        });
      }
    }

    entry.lastDataBindingValuesKey = valueKey;
    entry.lastDataBindingTriggerKey = triggerKey;
  }

  renderClipAtTime(
    clip: TimelineClip,
    timelineTime: number,
    settingsOverride?: VectorAnimationClipSettings,
  ): HTMLCanvasElement | null {
    if (clip.source?.type !== 'rive') {
      return clip.source?.textCanvas ?? null;
    }

    const entry = this.entries.get(clip.id);
    if (!entry?.isReady) {
      if (clip.file) {
        void this.prepareClipSource(clip).catch((error) => {
          log.warn('Failed to prepare Rive runtime during render', { clipId: clip.id, error });
        });
      }
      return clip.source?.textCanvas ?? null;
    }

    this.applySettings(entry, clip, settingsOverride);
    const settings = mergeVectorAnimationSettings(settingsOverride ?? clip.source?.vectorAnimationSettings);
    this.applyStateMachineInputs(entry, clip.id, settings);
    this.applyDataBindingValues(entry, settings);

    const animationDuration =
      entry.asset.metadata.duration ??
      clip.source?.naturalDuration ??
      clip.outPoint ??
      clip.duration ??
      DEFAULT_RIVE_DURATION;
    const animationTime = resolveAnimationTime(clip, animationDuration, settings, timelineTime);

    if (animationTime == null) {
      clearCanvas(entry.canvas);
      return entry.canvas;
    }

    const animationName = getSelectedAnimationName(entry.asset.metadata, settings);
    if (animationName) {
      entry.player.scrub(animationName, animationTime);
    }
    entry.player.drawFrame();
    return entry.canvas;
  }

  pruneClipRuntimes(knownClipIds: Iterable<string>): void {
    const keep = new Set(knownClipIds);
    for (const clipId of this.entries.keys()) {
      if (!keep.has(clipId)) {
        this.destroyClipRuntime(clipId);
      }
    }
  }

  destroyClipRuntime(clipId: string): void {
    const entry = this.entries.get(clipId);
    if (!entry) {
      return;
    }

    try {
      entry.player.off(EventType.RiveEvent, entry.riveEventHandler);
      this.resetViewModelBinding(entry);
      entry.player.cleanup();
    } catch (error) {
      log.warn('Failed to destroy Rive runtime', { clipId, error });
    } finally {
      entry.releaseRuntimeResource?.();
    }
    this.entries.delete(clipId);
  }

  destroyAll(): void {
    for (const clipId of this.entries.keys()) {
      this.destroyClipRuntime(clipId);
    }
  }
}

export const riveRuntimeManager = new RiveRuntimeManager();
