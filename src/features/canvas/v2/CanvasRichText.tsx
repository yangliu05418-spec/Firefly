import { useEffect, useMemo, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $convertToMarkdownString, $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { $getRoot, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND, type EditorState, type LexicalEditor } from "lexical";

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

export function CanvasRichText({ value, readOnly, onChange, onSelection }: { value: string; readOnly: boolean; onChange: (markdown: string, json: Record<string, unknown>) => void; onSelection?: (text: string) => void }) {
  const latestMarkdown = useRef(value);
  const config = useMemo(() => ({
    namespace: "FireflyCanvasText",
    editable: !readOnly,
    nodes: [HeadingNode, QuoteNode],
    onError(error: Error) { throw error; },
    editorState: () => { if (value) $convertFromMarkdownString(value, TRANSFORMERS); else $getRoot().clear(); },
    theme: { paragraph: "canvas-v2-richtext__paragraph", heading: { h1: "canvas-v2-richtext__h1", h2: "canvas-v2-richtext__h2", h3: "canvas-v2-richtext__h3" }, quote: "canvas-v2-richtext__quote" },
  }), [readOnly]);
  const handleChange = (state: EditorState, editor: LexicalEditor) => {
    state.read(() => { const markdown = $convertToMarkdownString(TRANSFORMERS); latestMarkdown.current = markdown; onChange(markdown, state.toJSON() as unknown as Record<string, unknown>); });
  };
  return <LexicalComposer initialConfig={config}>
    <ExternalStatePlugin value={value} readOnly={readOnly} latestMarkdown={latestMarkdown} />
    <SelectionPlugin onSelection={onSelection} />
    <RichTextPlugin contentEditable={<ContentEditable className="canvas-v2-richtext" aria-label="文本节点内容" />} placeholder={<span className="canvas-v2-richtext__placeholder">写下一段场景、对白或镜头说明…</span>} ErrorBoundary={LexicalErrorBoundary} />
    {!readOnly && <><HistoryPlugin /><MarkdownShortcutPlugin transformers={TRANSFORMERS} /><OnChangePlugin onChange={handleChange} /></>}
  </LexicalComposer>;
}
