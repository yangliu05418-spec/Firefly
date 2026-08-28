import { startBatch, endBatch } from '../../../../stores/historyStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../stores/timeline/types';
import type {
  ClipCustomNodeDefinition,
  ClipCustomNodeParamDefinition,
  ClipCustomNodeParamValue,
} from '../../../../services/nodeGraph';
import { EditableDraggableNumber as DraggableNumber } from '../../../common/EditableDraggableNumber';
import { KeyframeToggle, MultiKeyframeToggle } from '../../properties/shared';
import { hexColorToRgb, normalizeHexColor } from '../../../../utils/colorParam';
import { createNodeGraphParamPropertyKey } from './nodeWorkspaceUtils';

function clampAINodeNumber(value: number, param: ClipCustomNodeParamDefinition): number {
  return Math.min(param.max ?? Number.POSITIVE_INFINITY, Math.max(param.min ?? Number.NEGATIVE_INFINITY, value));
}

function getAINodeNumberDecimals(param: ClipCustomNodeParamDefinition): number {
  return param.step && param.step >= 1 ? 0 : param.step && param.step >= 0.1 ? 1 : 2;
}

function getAINodeParamValue(
  definition: ClipCustomNodeDefinition,
  param: ClipCustomNodeParamDefinition,
  interpolatedParams?: Record<string, ClipCustomNodeParamValue>,
): ClipCustomNodeParamValue {
  return interpolatedParams?.[param.id] ?? definition.params?.[param.id] ?? param.default;
}

function coerceAINodeParamValue(value: string, param: ClipCustomNodeParamDefinition): ClipCustomNodeParamValue {
  if (param.type === 'number') {
    return clampAINodeNumber(Number(value) || 0, param);
  }
  if (param.type === 'boolean') {
    return value === 'true';
  }
  if (param.type === 'color') {
    return normalizeHexColor(value, String(param.default));
  }
  const matchingOption = param.options?.find((option) => String(option.value) === value);
  return matchingOption?.value ?? value;
}

export function AINodeExposedParameters({
  clip,
  definition,
}: {
  clip: TimelineClip;
  definition: ClipCustomNodeDefinition;
}) {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const getInterpolatedNodeGraphParams = useTimelineStore((state) => state.getInterpolatedNodeGraphParams);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const isRecording = useTimelineStore((state) => state.isRecording);
  const hasKeyframes = useTimelineStore((state) => state.hasKeyframes);
  const schema = definition.parameterSchema ?? [];

  if (schema.length === 0) {
    return null;
  }

  const clipLocalTime = playheadPosition - clip.startTime;
  const interpolatedParams = getInterpolatedNodeGraphParams(clip.id, definition.id, clipLocalTime);
  const updateStaticParam = (paramId: string, value: ClipCustomNodeParamValue) => {
    updateClipAICustomNode(clip.id, definition.id, {
      params: {
        ...(definition.params ?? {}),
        [paramId]: value,
      },
    });
  };

  return (
    <div className="node-workspace-ai-exposed">
      <div className="node-workspace-ai-exposed-title">Parameters</div>
      <div className="node-workspace-ai-exposed-list">
        {schema.map((param) => {
          const value = getAINodeParamValue(definition, param, interpolatedParams);

          if (param.type === 'number') {
            const numericValue = typeof value === 'number' ? value : Number(param.default) || 0;
            const defaultValue = typeof param.default === 'number' ? param.default : 0;
            const property = createNodeGraphParamPropertyKey(definition.id, param.id);
            const range = (param.max ?? 1) - (param.min ?? 0);

            return (
              <div
                key={param.id}
                className="node-workspace-ai-param-row"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPropertyValue(clip.id, property, defaultValue);
                }}
              >
                <KeyframeToggle clipId={clip.id} property={property} value={numericValue} />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <DraggableNumber
                  value={numericValue}
                  onChange={(nextValue) => setPropertyValue(clip.id, property, clampAINodeNumber(nextValue, param))}
                  defaultValue={defaultValue}
                  decimals={getAINodeNumberDecimals(param)}
                  min={param.min}
                  max={param.max}
                  sensitivity={Math.max(0.1, Math.abs(range) / 100)}
                  persistenceKey={`node.ai.${clip.id}.${definition.id}.${param.id}`}
                  onDragStart={() => startBatch('Adjust AI node parameter')}
                  onDragEnd={() => endBatch()}
                />
              </div>
            );
          }

          if (param.type === 'boolean') {
            return (
              <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-static">
                <span className="node-workspace-ai-param-spacer" />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => updateStaticParam(param.id, event.target.checked)}
                />
              </label>
            );
          }

          if (param.type === 'select') {
            return (
              <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-static">
                <span className="node-workspace-ai-param-spacer" />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <select
                  value={String(value)}
                  onChange={(event) => updateStaticParam(param.id, coerceAINodeParamValue(event.target.value, param))}
                >
                  {param.options?.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                  ))}
                </select>
              </label>
            );
          }

          if (param.type === 'color') {
            const colorValue = normalizeHexColor(value, String(param.default));
            const color = hexColorToRgb(colorValue, String(param.default));
            const channelEntries = ([
              ['r', color.r],
              ['g', color.g],
              ['b', color.b],
            ] as const).map(([channel, channelValue]) => ({
              property: createNodeGraphParamPropertyKey(definition.id, `${param.id}.${channel}`),
              value: channelValue,
            }));
            const isKeyedColor = channelEntries.some(({ property }) => (
              isRecording(clip.id, property) || hasKeyframes(clip.id, property)
            ));
            const updateColor = (nextColor: string) => {
              const normalized = normalizeHexColor(nextColor, colorValue);
              const nextRgb = hexColorToRgb(normalized, colorValue);

              if (isKeyedColor) {
                startBatch('Adjust AI node color');
                try {
                  setPropertyValue(clip.id, channelEntries[0].property, nextRgb.r);
                  setPropertyValue(clip.id, channelEntries[1].property, nextRgb.g);
                  setPropertyValue(clip.id, channelEntries[2].property, nextRgb.b);
                } finally {
                  endBatch();
                }
                return;
              }

              updateStaticParam(param.id, normalized);
            };

            return (
              <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-color">
                <MultiKeyframeToggle
                  clipId={clip.id}
                  entries={channelEntries}
                  dragId={`${clip.id}:node:${definition.id}:${param.id}:color`}
                  title="Add color keyframes"
                />
                <span className="node-workspace-ai-param-label">{param.label}</span>
                <span className="node-workspace-ai-color-control">
                  <input
                    type="color"
                    value={colorValue}
                    onChange={(event) => updateColor(event.target.value)}
                  />
                  <span>{colorValue}</span>
                </span>
              </label>
            );
          }

          return (
            <label key={param.id} className="node-workspace-ai-param-row node-workspace-ai-param-row-static">
              <span className="node-workspace-ai-param-spacer" />
              <span className="node-workspace-ai-param-label">{param.label}</span>
              <input
                type="text"
                value={String(value)}
                onChange={(event) => updateStaticParam(param.id, event.target.value)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
