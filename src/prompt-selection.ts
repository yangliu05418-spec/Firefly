export function clearEditorSelection(editor: HTMLElement, selection = window.getSelection()) {
  const anchor = selection?.anchorNode;
  if (!selection || !anchor || !editor.contains(anchor)) return false;
  selection.removeAllRanges();
  return true;
}
