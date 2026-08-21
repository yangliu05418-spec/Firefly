import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HorizontalRuleNode, INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $convertToMarkdownString, $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { $patchStyleText, $setBlocksType } from "@lexical/selection";
import { CodeNode } from "@lexical/code-core";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { Bold, Eraser, Expand, Heading1, Heading2, Heading3, Italic, Minus, Palette, Quote, Underline, X } from "lucide-react";
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, FORMAT_TEXT_COMMAND, SELECTION_CHANGE_COMMAND, type EditorState } from "lexical";

function ExternalStatePlugin({ value, readOnly, latestMarkdown }: { value: string; readOnly: boolean; latestMarkdown: React.MutableRefObject<string> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => { editor.setEditable(!readOnly); }, [editor, readOnly]);
  useEffect(() => {
    if (value === latestMarkdown.current) return;
    latestMarkdown.current = value;
    editor.update(() => { $getRoot().clear(); if (value) $convertFromMarkdownString(value, TRANSFORMERS); });
  }, [editor, latestMarkdown, value]);
  return null;
}

function SelectionPlugin({ onSelection }: { onSelection?: (text: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
    editor.getEditorState().read(() => { const selection = $getSelection(); onSelection?.($isRangeSelection(selection) ? selection.getTextContent() : ""); });
    return false;
  }, COMMAND_PRIORITY_LOW), [editor, onSelection]);
  return null;
}

function RichTextToolbar({ closeExpanded }: { closeExpanded?: () => void }) {
  const [editor] = useLexicalComposerContext();
  const setBlock = (kind: "h1" | "h2" | "h3" | "quote") => editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) $setBlocksType(selection, () => kind === "quote" ? $createQuoteNode() : $createHeadingNode(kind));
  });
  return <div className="canvas-v2-richtext__toolbar" role="toolbar" aria-label="文本格式">
    <label title="文字颜色"><Palette /><input type="color" defaultValue="#d7ddd9" onChange={(event) => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) $patchStyleText(selection, { color: event.target.value }); })} /></label>
    <button type="button" title="H1 标题" onClick={() => setBlock("h1")}><Heading1 /></button><button type="button" title="H2 标题" onClick={() => setBlock("h2")}><Heading2 /></button><button type="button" title="H3 标题" onClick={() => setBlock("h3")}><Heading3 /></button>
    <button type="button" title="分隔线" onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}><Minus /></button><button type="button" title="加粗" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}><Bold /></button><button type="button" title="斜体" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}><Italic /></button><button type="button" title="引用" onClick={() => setBlock("quote")}><Quote /></button><button type="button" title="下划线" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}><Underline /></button>
    <button type="button" title="清空" onClick={() => editor.update(() => { $getRoot().clear().append($createParagraphNode()); })}><Eraser /></button>{closeExpanded && <button type="button" title="退出放大编辑" onClick={closeExpanded}><X /></button>}
  </div>;
}

export function CanvasRichText({ value, richText, readOnly, onChange, onSelection }: { value: string; richText?: Record<string, unknown>; readOnly: boolean; onChange: (markdown: string, json: Record<string, unknown>) => void; onSelection?: (text: string) => void }) {
  const latestMarkdown = useRef(value);
  const [expanded, setExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeExpanded = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus());
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("[contenteditable=true]")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeExpanded(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[contenteditable=true],[tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", keydown); };
  }, [closeExpanded, expanded]);
  const config = useMemo(() => ({
    namespace: "FireflyCanvasText",
    editable: !readOnly,
    nodes: [HeadingNode, QuoteNode, HorizontalRuleNode, CodeNode, LinkNode, ListNode, ListItemNode],
    onError(error: Error) { throw error; },
    editorState: richText && Object.keys(richText).length ? JSON.stringify(richText) : () => { if (value) $convertFromMarkdownString(value, TRANSFORMERS); else $getRoot().clear(); },
    theme: { paragraph: "canvas-v2-richtext__paragraph", heading: { h1: "canvas-v2-richtext__h1", h2: "canvas-v2-richtext__h2", h3: "canvas-v2-richtext__h3" }, quote: "canvas-v2-richtext__quote", text: { bold: "canvas-v2-richtext__bold", italic: "canvas-v2-richtext__italic", underline: "canvas-v2-richtext__underline" } },
  // Serialized rich text is the initial display truth. Later model updates intentionally arrive as Markdown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [readOnly]);
  const handleChange = (state: EditorState) => {
    state.read(() => { const markdown = $convertToMarkdownString(TRANSFORMERS); latestMarkdown.current = markdown; onChange(markdown, state.toJSON() as unknown as Record<string, unknown>); });
  };
  const shell = <div className={`canvas-v2-richtext-shell${expanded ? " canvas-v2-richtext-shell--expanded" : ""}`}>
      {!readOnly && <RichTextToolbar closeExpanded={expanded ? closeExpanded : undefined} />}
      <ExternalStatePlugin value={value} readOnly={readOnly} latestMarkdown={latestMarkdown} />
      <SelectionPlugin onSelection={onSelection} />
      <RichTextPlugin contentEditable={<ContentEditable className="canvas-v2-richtext" aria-label="文本节点内容" />} placeholder={<span className="canvas-v2-richtext__placeholder">写下一段场景、对白或镜头说明…</span>} ErrorBoundary={LexicalErrorBoundary} />
      {!readOnly && <><HistoryPlugin /><HorizontalRulePlugin /><MarkdownShortcutPlugin transformers={TRANSFORMERS} /><OnChangePlugin onChange={handleChange} /></>}
    {!readOnly && !expanded && <button ref={expandButton} type="button" className="canvas-v2-richtext__expand" title="放大编辑" aria-haspopup="dialog" onClick={() => setExpanded(true)}><Expand /></button>}
  </div>;
  return <LexicalComposer initialConfig={config}>
    {expanded ? createPortal(<div ref={dialog} className="canvas-v2-richtext-dialog" role="dialog" aria-modal="true" aria-label="放大编辑文本" onMouseDown={(event) => { if (event.target === event.currentTarget) closeExpanded(); }}>{shell}</div>, document.body) : shell}
  </LexicalComposer>;
}
