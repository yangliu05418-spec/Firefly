export type WorkerGpuGraphId = string;
export type WorkerGpuGraphVersion = number;

export interface WorkerGpuVector2 {
  readonly x: number;
  readonly y: number;
}

export interface WorkerGpuRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorkerGpuRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface WorkerGpuTransform2D {
  readonly anchor: WorkerGpuVector2;
  readonly position: WorkerGpuVector2;
  readonly scale: WorkerGpuVector2;
  readonly rotationRadians: number;
}

export type WorkerGpuBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add'
  | 'subtract';

export type WorkerGpuLayerFramePolicy = 'exact' | 'nearest' | 'hold';

export interface WorkerGpuSolidSource {
  readonly kind: 'solid';
  readonly color: WorkerGpuRgba;
}

export interface WorkerGpuVideoSource {
  readonly kind: 'video';
  readonly providerId: WorkerGpuGraphId;
  readonly sourceId: WorkerGpuGraphId;
  readonly assetId: WorkerGpuGraphId;
  readonly intrinsicSize: WorkerGpuVector2;
  readonly framePolicy: WorkerGpuLayerFramePolicy;
  readonly colorSpace: 'srgb' | 'rec709' | 'display-p3' | 'unknown';
  readonly alphaMode: 'opaque' | 'premultiplied' | 'straight';
}

export type WorkerGpuLayerSource = WorkerGpuSolidSource | WorkerGpuVideoSource;

export interface WorkerGpuLayerTiming {
  readonly timelineStart: number;
  readonly timelineDuration: number;
  readonly sourceOffset: number;
  readonly playbackRate: number;
}

export interface WorkerGpuLayer {
  readonly id: WorkerGpuGraphId;
  readonly trackId: WorkerGpuGraphId;
  readonly order: number;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: WorkerGpuBlendMode;
  readonly timing: WorkerGpuLayerTiming;
  readonly transform: WorkerGpuTransform2D;
  readonly sourceRect: WorkerGpuRect;
  readonly masks: readonly WorkerGpuGraphId[];
  readonly effects: readonly WorkerGpuGraphId[];
  readonly source: WorkerGpuLayerSource;
}

export interface WorkerGpuCompositionGraph {
  readonly id: WorkerGpuGraphId;
  readonly version: WorkerGpuGraphVersion;
  readonly name: string;
  readonly duration: number;
  readonly size: WorkerGpuVector2;
  readonly clearColor: WorkerGpuRgba;
  readonly layers: readonly WorkerGpuLayer[];
}

export interface WorkerGpuProjectRenderGraph {
  readonly id: WorkerGpuGraphId;
  readonly version: WorkerGpuGraphVersion;
  readonly activeCompositionId: WorkerGpuGraphId;
  readonly compositions: Readonly<Record<WorkerGpuGraphId, WorkerGpuCompositionGraph>>;
}

export type WorkerGpuRenderGraphDeltaOperation =
  | {
      readonly type: 'upsertComposition';
      readonly composition: WorkerGpuCompositionGraph;
    }
  | {
      readonly type: 'removeComposition';
      readonly compositionId: WorkerGpuGraphId;
    }
  | {
      readonly type: 'upsertLayer';
      readonly compositionId: WorkerGpuGraphId;
      readonly layer: WorkerGpuLayer;
    }
  | {
      readonly type: 'removeLayer';
      readonly compositionId: WorkerGpuGraphId;
      readonly layerId: WorkerGpuGraphId;
    }
  | {
      readonly type: 'setActiveComposition';
      readonly compositionId: WorkerGpuGraphId;
    }
  | {
      readonly type: 'setCompositionSize';
      readonly compositionId: WorkerGpuGraphId;
      readonly size: WorkerGpuVector2;
    }
  | {
      readonly type: 'setCompositionClearColor';
      readonly compositionId: WorkerGpuGraphId;
      readonly clearColor: WorkerGpuRgba;
    };

export interface WorkerGpuRenderGraphDelta {
  readonly graphId: WorkerGpuGraphId;
  readonly baseVersion: WorkerGpuGraphVersion;
  readonly nextVersion: WorkerGpuGraphVersion;
  readonly operations: readonly WorkerGpuRenderGraphDeltaOperation[];
}
