/**
 * 快捷键守卫（纯函数）。
 * 移植自 infinite-canvas（MIT）lib/keyboard-event.ts + project.tsx handleKeyDown：
 * 输入框/文本域/下拉/可编辑区域/媒体播放器内不触发快捷键；IME 组合期间按键不作为快捷键。
 */

type KeyboardEventLike = { isComposing?: boolean; keyCode?: number; which?: number };

/** IME 输入法组合中（中文输入法等）；keyCode 229 是 Windows IME 组合标志 */
export const isImeComposing = (event: KeyboardEventLike): boolean => Boolean(event.isComposing || event.keyCode === 229 || event.which === 229);

/** 事件目标是否位于交互控件内（输入框/文本域/下拉/可编辑区/媒体播放器/显式忽略区） */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return Boolean(target.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]"));
};
