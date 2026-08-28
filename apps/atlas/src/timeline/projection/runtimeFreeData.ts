import type { TimelineRuntimeReferenceIssue } from './TimelineProjection';

const OBJECT_URL_PATTERN = /^blob:/i;

function getValueTag(value: unknown): string {
  return Object.prototype.toString.call(value);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(parentPath: string, key: string | number): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
}

export function findTimelineRuntimeReferences(
  value: unknown,
  path = '$',
  stack: WeakSet<object> = new WeakSet(),
): TimelineRuntimeReferenceIssue[] {
  if (typeof value === 'function') {
    return [{ path, code: 'function', valueTag: getValueTag(value) }];
  }

  if (typeof value === 'symbol') {
    return [{ path, code: 'symbol', valueTag: getValueTag(value) }];
  }

  if (typeof value === 'string') {
    return OBJECT_URL_PATTERN.test(value)
      ? [{ path, code: 'object-url', valueTag: 'string' }]
      : [];
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  if (stack.has(value)) {
    return [{ path, code: 'cycle', valueTag: getValueTag(value) }];
  }
  stack.add(value);

  if (Array.isArray(value)) {
    const issues = value.flatMap((entry, index) => findTimelineRuntimeReferences(entry, childPath(path, index), stack));
    stack.delete(value);
    return issues;
  }

  if (!isPlainObject(value)) {
    stack.delete(value);
    return [{ path, code: 'non-plain-object', valueTag: getValueTag(value) }];
  }

  const issues = Object.entries(value).flatMap(([key, entry]) => (
    findTimelineRuntimeReferences(entry, childPath(path, key), stack)
  ));
  stack.delete(value);
  return issues;
}

export function isPlainTimelineRenderData(value: unknown): boolean {
  return findTimelineRuntimeReferences(value).length === 0;
}
