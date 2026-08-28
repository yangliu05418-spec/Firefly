import type { JsonValue, SignalMetadata } from '../signals';
import { getFileExtension } from './fileIdentity';

export const JSON_SUMMARY_FORMAT = 'masterselects.json-summary';

const MAX_FULL_PARSE_BYTES = 1024 * 1024;
const MAX_SAMPLE_BYTES = 256 * 1024;
const MAX_PREVIEW_ENTRIES = 5;
const MAX_PREVIEW_DEPTH = 2;
const MAX_PREVIEW_STRING = 120;
const MAX_SAMPLE_PREVIEW_CHARS = 480;

export type JsonFormat = 'json' | 'jsonl';
type JsonTopLevelType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'jsonl';
type JsonValueType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
type JsonHistogram = Record<JsonValueType, number>;

export interface JsonSummary {
  format: JsonFormat;
  topLevelType: JsonTopLevelType;
  keyCount?: number;
  arrayLength?: number;
  depth: number;
  valueTypeHistogram: JsonHistogram;
  preview: JsonValue;
  truncated: boolean;
  bytesSampled: number;
  sourceBytes: number;
  parseMode: 'full' | 'sample';
  diagnostics: string[];
}

function createHistogram(): JsonHistogram {
  return { null: 0, boolean: 0, number: 0, string: 0, array: 0, object: 0 };
}

function mergeHistogram(target: JsonHistogram, source: JsonHistogram): void {
  (Object.keys(target) as JsonValueType[]).forEach((key) => {
    target[key] += source[key];
  });
}

function truncateString(value: string, maxLength = MAX_PREVIEW_STRING): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function decodeUtf8(fileBytes: ArrayBuffer, maxBytes = fileBytes.byteLength): string {
  const byteLength = Math.min(fileBytes.byteLength, maxBytes);
  return new TextDecoder().decode(new Uint8Array(fileBytes, 0, byteLength)).replace(/^\uFEFF/, '');
}

export function getJsonFormat(fileName: string): JsonFormat {
  return getFileExtension(fileName) === 'jsonl' ? 'jsonl' : 'json';
}

function getJsonValueType(value: JsonValue): JsonValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

function previewValue(value: JsonValue, depth = 0): JsonValue {
  if (typeof value === 'string') return truncateString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_PREVIEW_DEPTH) return `[array:${value.length}]`;
    return value.slice(0, MAX_PREVIEW_ENTRIES).map((entry) => previewValue(entry, depth + 1));
  }
  if (depth >= MAX_PREVIEW_DEPTH) return `{object:${Object.keys(value).length}}`;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_PREVIEW_ENTRIES)
      .map(([key, entry]) => [key, previewValue(entry, depth + 1)]),
  ) as Record<string, JsonValue>;
}

function collectStructure(value: JsonValue): { depth: number; histogram: JsonHistogram } {
  const histogram = createHistogram();
  const stack: Array<{ value: JsonValue; depth: number }> = [{ value, depth: 0 }];
  let depth = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    const valueType = getJsonValueType(current.value);
    histogram[valueType] += 1;
    if (Array.isArray(current.value)) {
      const childDepth = current.depth + 1;
      depth = Math.max(depth, childDepth);
      current.value.forEach((entry) => stack.push({ value: entry, depth: childDepth }));
    } else if (current.value && typeof current.value === 'object') {
      const childDepth = current.depth + 1;
      depth = Math.max(depth, childDepth);
      Object.values(current.value).forEach((entry) => stack.push({ value: entry, depth: childDepth }));
    }
  }
  return { depth, histogram };
}

function summarizeParsedJson(value: JsonValue, sourceBytes: number): JsonSummary {
  const structure = collectStructure(value);
  const summary: JsonSummary = {
    format: 'json',
    topLevelType: getJsonValueType(value),
    depth: structure.depth,
    valueTypeHistogram: structure.histogram,
    preview: previewValue(value),
    truncated: false,
    bytesSampled: sourceBytes,
    sourceBytes,
    parseMode: 'full',
    diagnostics: [],
  };
  if (Array.isArray(value)) summary.arrayLength = value.length;
  else if (value && typeof value === 'object') summary.keyCount = Object.keys(value).length;
  return summary;
}

function summarizeParsedJsonLines(
  values: JsonValue[],
  sourceBytes: number,
  bytesSampled: number,
  diagnostics: string[],
): JsonSummary {
  const histogram = createHistogram();
  let depth = 0;
  values.forEach((value) => {
    const structure = collectStructure(value);
    mergeHistogram(histogram, structure.histogram);
    depth = Math.max(depth, structure.depth);
  });
  const firstObject = values.find((value) => value && !Array.isArray(value) && typeof value === 'object');
  const summary: JsonSummary = {
    format: 'jsonl',
    topLevelType: 'jsonl',
    arrayLength: values.length,
    depth,
    valueTypeHistogram: histogram,
    preview: values.slice(0, MAX_PREVIEW_ENTRIES).map((entry) => previewValue(entry)),
    truncated: diagnostics.length > 0,
    bytesSampled,
    sourceBytes,
    parseMode: diagnostics.length > 0 ? 'sample' : 'full',
    diagnostics,
  };
  if (firstObject && !Array.isArray(firstObject) && typeof firstObject === 'object') {
    summary.keyCount = Object.keys(firstObject).length;
  }
  return summary;
}

function parseJsonLines(text: string, sourceBytes: number, bytesSampled: number, truncated: boolean): JsonSummary {
  const normalized = truncated && !text.endsWith('\n')
    ? text.slice(0, Math.max(0, text.lastIndexOf('\n')))
    : text;
  const values: JsonValue[] = [];
  normalized.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      values.push(JSON.parse(trimmed) as JsonValue);
    } catch (error) {
      throw new Error(`JSONL parse failed at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const diagnostics = truncated
    ? [`JSONL summary is based on the first ${bytesSampled} bytes.`]
    : [];
  if (values.length === 0 && truncated) {
    return {
      format: 'jsonl',
      topLevelType: 'jsonl',
      arrayLength: 0,
      depth: estimateSampleDepth(text),
      valueTypeHistogram: estimateSampleHistogram(text),
      preview: truncateString(text.slice(0, MAX_SAMPLE_PREVIEW_CHARS), MAX_SAMPLE_PREVIEW_CHARS),
      truncated: true,
      bytesSampled,
      sourceBytes,
      parseMode: 'sample',
      diagnostics: [...diagnostics, 'No complete JSONL records were found inside the sampled range.'],
    };
  }
  if (values.length === 0) throw new Error('JSONL file has no complete JSON records.');
  return summarizeParsedJsonLines(values, sourceBytes, bytesSampled, diagnostics);
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function estimateSampleDepth(text: string): number {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (char === '}' || char === ']') {
      depth = Math.max(0, depth - 1);
    }
  }
  return maxDepth;
}

function estimateSampleHistogram(text: string): JsonHistogram {
  const histogram = createHistogram();
  const strings = countMatches(text, /"(?:[^"\\]|\\.)*"/g);
  const keys = countMatches(text, /"(?:[^"\\]|\\.)*"\s*:/g);
  histogram.object = countMatches(text, /\{/g);
  histogram.array = countMatches(text, /\[/g);
  histogram.string = Math.max(0, strings - keys);
  histogram.boolean = countMatches(text, /\b(?:true|false)\b/g);
  histogram.null = countMatches(text, /\bnull\b/g);
  histogram.number = countMatches(text, /(?:^|[^\w.])[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  return histogram;
}

function topLevelTypeFromSample(text: string): JsonTopLevelType | undefined {
  const first = text.trimStart()[0];
  if (first === '{') return 'object';
  if (first === '[') return 'array';
  if (first === '"') return 'string';
  if (first === 't' || first === 'f') return 'boolean';
  if (first === 'n') return 'null';
  if (first !== undefined && /[-0-9]/.test(first)) return 'number';
  return undefined;
}

function summarizeJsonSample(text: string, sourceBytes: number, bytesSampled: number): JsonSummary {
  const trimmed = text.trimStart();
  const topLevelType = topLevelTypeFromSample(trimmed);
  if (!topLevelType) throw new Error('JSON sample does not start with a valid JSON token.');
  const summary: JsonSummary = {
    format: 'json',
    topLevelType,
    depth: estimateSampleDepth(trimmed),
    valueTypeHistogram: estimateSampleHistogram(trimmed),
    preview: truncateString(trimmed.slice(0, MAX_SAMPLE_PREVIEW_CHARS), MAX_SAMPLE_PREVIEW_CHARS),
    truncated: true,
    bytesSampled,
    sourceBytes,
    parseMode: 'sample',
    diagnostics: [`JSON file exceeds ${MAX_FULL_PARSE_BYTES} bytes; summary is based on the first ${bytesSampled} bytes.`],
  };
  if (topLevelType === 'object') summary.keyCount = countMatches(trimmed, /"(?:[^"\\]|\\.)*"\s*:/g);
  if (topLevelType === 'array') summary.arrayLength = Math.max(0, countMatches(trimmed, /,/g) + 1);
  return summary;
}

export function summarizeJsonBytes(fileName: string, fileBytes: ArrayBuffer): JsonSummary {
  const format = getJsonFormat(fileName);
  const truncated = fileBytes.byteLength > MAX_FULL_PARSE_BYTES;
  if (format === 'jsonl') {
    const bytesSampled = truncated ? MAX_SAMPLE_BYTES : fileBytes.byteLength;
    return parseJsonLines(decodeUtf8(fileBytes, bytesSampled), fileBytes.byteLength, bytesSampled, truncated);
  }
  if (truncated) {
    return summarizeJsonSample(decodeUtf8(fileBytes, MAX_SAMPLE_BYTES), fileBytes.byteLength, MAX_SAMPLE_BYTES);
  }
  return summarizeParsedJson(JSON.parse(decodeUtf8(fileBytes)) as JsonValue, fileBytes.byteLength);
}

export function buildJsonSummaryMetadata(summary: JsonSummary): SignalMetadata {
  const metadata: SignalMetadata = {
    format: summary.format,
    summaryFormat: JSON_SUMMARY_FORMAT,
    topLevelType: summary.topLevelType,
    depth: summary.depth,
    valueTypeHistogram: summary.valueTypeHistogram,
    preview: summary.preview,
    truncated: summary.truncated,
    bytesSampled: summary.bytesSampled,
    sourceBytes: summary.sourceBytes,
    parseMode: summary.parseMode,
  };
  if (summary.keyCount !== undefined) metadata.keyCount = summary.keyCount;
  if (summary.arrayLength !== undefined) metadata.arrayLength = summary.arrayLength;
  if (summary.diagnostics.length > 0) metadata.diagnostics = summary.diagnostics;
  return metadata;
}
