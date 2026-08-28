import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from 'react';
import type { TextSelectionRange } from './textPreviewTypes';

export function useTextSelectionState(params: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isEditing: boolean;
}) {
  const { textareaRef, isEditing } = params;
  const [textSelection, setTextSelection] = useState<TextSelectionRange>({ start: 0, end: 0 });

  const syncTextSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
    setTextSelection(previous => (
      previous.start === start && previous.end === end
        ? previous
        : { start, end }
    ));
  }, [textareaRef]);

  // Update the selection highlight live while dragging (the textarea's onSelect
  // doesn't fire reliably mid-drag). `selectionchange` fires continuously.
  useEffect(() => {
    if (!isEditing) return undefined;
    const handleSelectionChange = () => {
      if (document.activeElement === textareaRef.current) {
        syncTextSelection();
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [isEditing, syncTextSelection, textareaRef]);

  return {
    textSelection,
    setTextSelection,
    syncTextSelection,
  };
}
