import type { TextClipProperties } from "../../types/text";
import type { ClipCustomNodeDefinition } from "../../types/nodeGraph";
import { extractAINodeGeneratedCode } from './aiNodeDefinition';
import { Logger } from '../logger';
import { textRenderer } from '../textRenderer';
import type { AINodeRuntimeTexture } from './aiNodeRuntime';
import {
  createRuntimeTime,
  type AINodeRuntimeContext,
  type AINodeRuntimeInputValue,
} from './aiNodeRuntimeGraphSignals';

const log = Logger.create('AINodeRuntime');

type AINodeProcessFunction = (
  input: Record<string, AINodeRuntimeInputValue>,
  context: AINodeRuntimeContext,
) => { output?: AINodeRuntimeTexture } | AINodeRuntimeTexture | undefined;

interface AINodeExecutable {
  process?: AINodeProcessFunction;
}

const executableCache = new Map<string, AINodeExecutable | null>();

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function isRuntimeTexture(value: unknown): value is AINodeRuntimeTexture {
  const candidate = value as Partial<AINodeRuntimeTexture> | null;
  return !!candidate &&
    candidate.data instanceof Uint8ClampedArray &&
    typeof candidate.width === 'number' &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    candidate.height > 0;
}

function getReturnedTextValue(output: AINodeRuntimeTexture | undefined): string | Partial<TextClipProperties> | undefined {
  if (!output) {
    return undefined;
  }

  if (typeof output.text === 'string' || getRecord(output.text)) {
    return output.text;
  }

  const metadata = getRecord(output.metadata);
  const metadataText = getRecord(metadata?.text);
  const content = metadataText?.content;
  if (typeof content === 'string') {
    return content;
  }

  const text = metadataText?.text;
  return typeof text === 'string' ? text : undefined;
}

function mergeReturnedMetadata(
  base: Record<string, unknown>,
  output: AINodeRuntimeTexture | undefined,
  result?: unknown,
): Record<string, unknown> {
  const resultMetadata = getRecord(getRecord(result)?.metadata);
  if (!output?.metadata && !resultMetadata) {
    return base;
  }
  return {
    ...base,
    ...(resultMetadata ?? {}),
    ...(output?.metadata ?? {}),
  };
}

function getTopLevelReturnedText(result: unknown): string | Partial<TextClipProperties> | undefined {
  const text = getRecord(result)?.text;
  return typeof text === 'string' || getRecord(text) ? text as string | Partial<TextClipProperties> : undefined;
}

function renderTextSignalToTexture(
  texture: AINodeRuntimeTexture,
  baseText: TextClipProperties | undefined,
  returnedText: string | Partial<TextClipProperties> | undefined,
): AINodeRuntimeTexture {
  if (!baseText || returnedText === undefined || typeof document === 'undefined') {
    return texture;
  }

  const textPatch = typeof returnedText === 'string'
    ? { text: returnedText }
    : returnedText;
  const textPatchRecord = getRecord(textPatch);
  const normalizedTextPatch = textPatchRecord &&
    typeof textPatchRecord.content === 'string' &&
    typeof textPatchRecord.text !== 'string'
    ? { ...textPatch, text: textPatchRecord.content }
    : textPatch;
  const nextText = {
    ...baseText,
    ...normalizedTextPatch,
  };
  const canvas = textRenderer.createCanvas(texture.width, texture.height);
  textRenderer.render(nextText, canvas);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return texture;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    ...texture,
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
    text: returnedText,
    metadata: mergeReturnedMetadata(texture.metadata ?? {}, texture),
  };
}

export function resolveCurrentTextProperties(
  baseText: TextClipProperties | undefined,
  texture: AINodeRuntimeTexture,
): TextClipProperties | undefined {
  if (!baseText || texture.text === undefined) {
    return baseText;
  }

  if (typeof texture.text === 'string') {
    return {
      ...baseText,
      text: texture.text,
    };
  }

  return {
    ...baseText,
    ...texture.text,
  };
}

function compileGeneratedNode(code: string, cacheKey: string): AINodeExecutable | null {
  const cached = executableCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let executable: AINodeExecutable | null = null;
  const defineNode = (definition: AINodeExecutable) => {
    executable = definition;
    return definition;
  };

  try {
    const run = new Function('defineNode', `"use strict";\n${code}\n;`);
    run(defineNode);
  } catch (error) {
    log.warn('Failed to compile generated AI node code', error);
  }

  executableCache.set(cacheKey, executable);
  return executable;
}

export function runGeneratedNode(
  definition: ClipCustomNodeDefinition,
  texture: AINodeRuntimeTexture,
  context: AINodeRuntimeContext,
  connectedInputs: Record<string, AINodeRuntimeInputValue> = {},
): AINodeRuntimeTexture {
  const code = extractAINodeGeneratedCode(definition.ai.generatedCode ?? '');
  if (!code) {
    return texture;
  }

  const executable = compileGeneratedNode(code, `${definition.id}:${code}`);
  if (!executable?.process) {
    return texture;
  }

  try {
    const result = executable.process(
      {
        input: texture,
        texture,
        time: createRuntimeTime(context),
        metadata: context.metadata,
        params: context.params,
        clip: context.clip,
        source: context.source,
        graph: context.graph,
        node: context.node,
        signals: context.signals,
        audio: context.audio,
        audioAnalysis: context.signals.audioAnalysis,
        frequencyBands: context.signals.frequencyBands,
        beats: context.signals.beats,
        onsets: context.signals.onsets,
        audioMetadata: context.signals.audioMetadata,
        audioRepairSuggestions: context.signals.audioRepairSuggestions,
        text: context.text,
        connectedInputs,
        ...connectedInputs,
      },
      context,
    );
    const output = 'output' in (result ?? {}) ? (result as { output?: AINodeRuntimeTexture }).output : result;
    if (!isRuntimeTexture(output)) {
      return texture;
    }

    const metadata = mergeReturnedMetadata(context.metadata, output, result);
    const returnedText = getReturnedTextValue(output) ?? getTopLevelReturnedText(result);
    return renderTextSignalToTexture(
      {
        ...output,
        metadata,
      },
      context.text,
      returnedText,
    );
  } catch (error) {
    log.warn('Generated AI node failed during render; passing input through', error);
    return texture;
  }
}
