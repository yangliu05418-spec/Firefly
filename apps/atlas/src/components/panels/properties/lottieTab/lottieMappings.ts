import {
  vectorAnimationDataBindingValueToNumber,
  type VectorAnimationDataBindingProperty,
  type VectorAnimationDataBindingValue,
  type VectorAnimationStateMachineInput,
} from '../../../../types/vectorAnimation';

export function cleanBackgroundColor(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

export function formatInputType(input: VectorAnimationStateMachineInput): string {
  if (input.type === 'boolean') return 'Bool';
  if (input.type === 'number') return 'Number';
  if (input.type === 'string') return 'Text';
  return 'Trigger';
}

export function formatDataBindingType(property: VectorAnimationDataBindingProperty): string {
  if (property.type === 'boolean') return 'Bool';
  if (property.type === 'integer') return 'Integer';
  if (property.type === 'number') return 'Number';
  if (property.type === 'color') return 'Color';
  if (property.type === 'enum') return 'Enum';
  if (property.type === 'string') return 'Text';
  return 'Trigger';
}

export function formatDimensionValue(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function riveColorToHex(value: VectorAnimationDataBindingValue | undefined): string {
  const numericValue = vectorAnimationDataBindingValueToNumber(value);
  const rgb = numericValue & 0xffffff;
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

export function hexToRiveColor(value: string): number {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '000000';
  return 0xff000000 | Number.parseInt(normalized, 16);
}
