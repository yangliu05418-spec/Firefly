import type { AudioArtifactStore } from '../AudioArtifactStore';
import type { AudioArtifactRef } from '../audioArtifactTypes';
import {
  LOUDNESS_CURVE_PAYLOAD_VERSION,
  encodeLoudnessCurvePayload,
  type LoudnessCurvePayloadRef,
} from '../loudnessEnvelopeManifest';
import type { LoudnessAnalysisContext, LoudnessCurveData } from './loudnessAnalysisTypes';

export const LOUDNESS_CURVE_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.loudness-curve';

export async function storeLoudnessCurvePayloads(input: {
  artifactStore: AudioArtifactStore;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  analyzerVersion: string;
  generatedAt: string;
  context: LoudnessAnalysisContext;
  curves: LoudnessCurveData[];
  now: () => string;
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void;
}): Promise<{
  curves: LoudnessCurvePayloadRef[];
  payloadRefs: AudioArtifactRef[];
}> {
  const payloadRefs: AudioArtifactRef[] = [];
  const curves: LoudnessCurvePayloadRef[] = [];

  for (let curveIndex = 0; curveIndex < input.curves.length; curveIndex += 1) {
    const curve = input.curves[curveIndex];
    input.context.onProgress?.({
      jobId: input.context.jobId,
      mediaFileId: input.context.mediaFileId,
      sourceFingerprint: input.context.sourceFingerprint,
      cacheKey: input.context.cacheKey,
      phase: 'storing-payloads',
      percent: 80 + (curveIndex / Math.max(1, input.curves.length)) * 15,
      timestamp: input.now(),
      metric: curve.metric,
      pointCount: curve.values.length,
      message: 'Storing loudness curve payload',
    });
    input.throwIfCancelled(input.context.signal, input.context.jobId);

    const payloadRef = await input.artifactStore.putPayload(encodeLoudnessCurvePayload({
      header: {
        schemaVersion: LOUDNESS_CURVE_PAYLOAD_VERSION,
        metric: curve.metric,
        channelIndex: curve.channelIndex,
        windowDuration: curve.windowDuration,
        hopDuration: curve.hopDuration,
        pointCount: curve.values.length,
        valueLayout: 'time-series',
        valueEncoding: 'db',
      },
      values: curve.values,
    }), {
      mediaFileId: input.mediaFileId,
      kind: 'loudness-envelope',
      sourceFingerprint: input.sourceFingerprint,
      clipAudioStateHash: input.clipAudioStateHash,
      mimeType: LOUDNESS_CURVE_PAYLOAD_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion: input.analyzerVersion,
      createdAt: input.generatedAt,
      sourceRefs: [`audio-analysis-cache:${input.context.cacheKey}`],
      metadata: {
        cacheKey: input.context.cacheKey,
        metric: curve.metric,
        channelIndex: curve.channelIndex ?? 0,
        windowDuration: curve.windowDuration,
        hopDuration: curve.hopDuration,
        pointCount: curve.values.length,
        valueEncoding: 'db',
      },
    });

    payloadRefs.push(payloadRef);
    curves.push({
      metric: curve.metric,
      channelIndex: curve.channelIndex,
      windowDuration: curve.windowDuration,
      hopDuration: curve.hopDuration,
      pointCount: curve.values.length,
      payloadRef,
    });
  }

  return { curves, payloadRefs };
}
