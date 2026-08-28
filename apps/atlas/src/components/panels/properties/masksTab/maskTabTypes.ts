import type { Keyframe } from "../../../../types/keyframes";

export const EMPTY_KEYFRAMES: Keyframe[] = [];

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
