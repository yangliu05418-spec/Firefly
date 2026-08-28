import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';

export function workerSoftwareFrameContentKey(frame: WorkerRenderSoftwareFrame): string {
  return frame.layers
    .map((layer) => [
      layer.id,
      layer.visible ? '1' : '0',
      layer.opacity.toFixed(4),
      layer.diagnosticContentKey ?? layer.source.kind,
      layer.transition?.kind ?? '',
      layer.geometry.position.x.toFixed(4),
      layer.geometry.position.y.toFixed(4),
      layer.geometry.scale.x.toFixed(4),
      layer.geometry.scale.y.toFixed(4),
      layer.geometry.rotation.toFixed(4),
    ].join(','))
    .join('|');
}
