import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, Library, LoaderCircle, Video } from "lucide-react";
import { api } from "../../api";
import { useAssetCacheUserId } from "../../asset-cache-context";
import { createPromptAssetToken, promptNodeText, renderPromptValue } from "../../prompt-editor-dom";
import { loadPromptLibraryCacheFirst } from "../../prompt-library-cache";
import { promptAssetLabel } from "../../prompt-references";
import { clearEditorSelection } from "../../prompt-selection";
import { RecoveringThumbnail } from "../../recovering-image";
import type { LibraryAsset, UploadAsset } from "../../types";

type PromptEditorProps = {
  value: string;
  placeholder: string;
  assets: UploadAsset[];
  disabled: boolean;
  attach: (asset: UploadAsset) => UploadAsset | null;
  change: (value: string) => void;
  focusSignal?: number;
};

export function PromptEditor({ value, placeholder, assets, disabled, attach, change, focusSignal }: PromptEditorProps) {
  const userId = useAssetCacheUserId();
  const editor = useRef<HTMLDivElement>(null); const mentionRange = useRef<Range | null>(null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [active, setActive] = useState(0); const [anchor, setAnchor] = useState({ left: 12, top: 12, above: false });
  const [library, setLibrary] = useState<UploadAsset[]>([]); const [libraryLoading, setLibraryLoading] = useState(false); const [libraryError, setLibraryError] = useState(false); const loadedLibrary = useRef(false); const libraryRequest = useRef(0);
  const sync = () => { if (editor.current) change(Array.from(editor.current.childNodes).map(promptNodeText).join("").replace(/\n{3,}/g, "\n\n")); };
  const candidates = useMemo(() => {
    const ready = assets.filter((asset) => asset.progress === 100);
    const merged = [...ready, ...library.filter((candidate) => !ready.some((asset) => asset.id === candidate.id))];
    const term = query.trim().toLocaleLowerCase();
    return (term ? merged.filter((asset) => asset.name.toLocaleLowerCase().includes(term) || promptAssetLabel(asset, merged).toLocaleLowerCase().includes(term)) : merged).slice(0, 30);
  }, [assets, library, query]);

  useEffect(() => {
    const node = editor.current;
    if (!node || document.activeElement === node) return;
    const rendered = Array.from(node.childNodes).map(promptNodeText).join("").replace(/\n{3,}/g, "\n\n");
    const staleToken = Array.from(node.querySelectorAll<HTMLElement>("[data-asset-id]")).some((token) => {
      const asset = assets.find((candidate) => candidate.id === token.dataset.assetId);
      return token.title !== (asset?.name ?? "正在恢复素材") || Boolean(token.querySelector("img")) !== Boolean(asset?.preview);
    });
    if (rendered !== value || staleToken) renderPromptValue(node, value, assets);
  }, [value, assets]);
  useEffect(() => {
    if (!focusSignal || !editor.current) return;
    const frame = window.requestAnimationFrame(() => {
      const node = editor.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSignal]);
  useEffect(() => {
    if (!editor.current) return;
    const attached = new Set(assets.map((asset) => asset.id)); let removed = false;
    editor.current.querySelectorAll<HTMLElement>("[data-asset-id]").forEach((token) => { if (!attached.has(token.dataset.assetId ?? "")) { token.remove(); removed = true; } });
    if (removed) sync();
  }, [assets]);
  useEffect(() => () => { libraryRequest.current += 1; }, []);

  const loadLibrary = () => {
    if (loadedLibrary.current) return;
    loadedLibrary.current = true; setLibraryLoading(true); setLibraryError(false);
    const request = ++libraryRequest.current;
    void loadPromptLibraryCacheFirst({
      userId,
      loadFresh: () => api.get<{ Items?: LibraryAsset[] }>("/api/assets").then((result) => result.Items ?? []),
      onCached: (cached) => {
        if (libraryRequest.current !== request) return;
        setLibrary(cached);
        setLibraryLoading(false);
      },
    }).then((result) => {
      if (libraryRequest.current !== request) return;
      setLibrary(result.assets);
    }).catch(() => {
      if (libraryRequest.current !== request) return;
      loadedLibrary.current = false;
      setLibrary([]);
      setLibraryError(true);
    }).finally(() => {
      if (libraryRequest.current === request) setLibraryLoading(false);
    });
  };

  const detectMention = () => {
    if (disabled) return setOpen(false);
    const selection = window.getSelection(); const node = selection?.anchorNode; const offset = selection?.anchorOffset ?? 0;
    if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE) return setOpen(false);
    const match = (node.textContent ?? "").slice(0, offset).match(/@([^\s@]*)$/u);
    if (!match) return setOpen(false);
    const range = document.createRange(); range.setStart(node, offset - match[0].length); range.setEnd(node, offset); mentionRange.current = range.cloneRange();
    const rect = range.getBoundingClientRect(); const above = window.innerHeight - rect.bottom < 330;
    setAnchor({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)), top: above ? rect.top - 8 : rect.bottom + 8, above });
    setQuery(match[1]); setActive(0); setOpen(true); loadLibrary();
  };

  const selectAsset = (candidate: UploadAsset) => {
    const asset = attach(candidate); const range = mentionRange.current;
    if (!asset || !range || !editor.current) return;
    const token = createPromptAssetToken(asset, asset.id);
    range.deleteContents(); range.insertNode(token); const space = document.createTextNode("\u00a0"); token.after(space);
    const selection = window.getSelection(); const caret = document.createRange(); caret.setStartAfter(space); caret.collapse(true); selection?.removeAllRanges(); selection?.addRange(caret);
    setOpen(false); setQuery(""); mentionRange.current = null; sync(); editor.current.focus();
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, candidates.length)) % Math.max(1, candidates.length)); }
    if (event.key === "Enter" && candidates[active]) { event.preventDefault(); selectAsset(candidates[active]); }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };

  const popup = open && createPortal(<div className={`mention-pop ${anchor.above ? "mention-pop--above" : ""}`} style={{ left: anchor.left, top: anchor.top }} role="listbox" aria-label="选择参考资产" onMouseDown={(event) => event.preventDefault()}>
    <header><span>@ 选择参考资产</span><small>{query ? `搜索“${query}”` : "输入名称可筛选"}</small></header>
    <div className="mention-pop__list">{libraryLoading && !candidates.length ? <div className="mention-pop__state"><LoaderCircle className="spin" /> 正在读取资产</div> : candidates.length ? candidates.map((asset, index) => <button key={asset.id} className={index === active ? "active" : ""} role="option" aria-selected={index === active} onMouseDown={(event) => { event.preventDefault(); selectAsset(asset); }}>
      {asset.preview ? <RecoveringThumbnail src={asset.preview} alt={asset.name || "参考素材"} fallbackClassName="mention-pop__media" manualRecovery={false} /> : <span className="mention-pop__media">{asset.type === "video" ? <Video /> : asset.type === "audio" ? <AudioLines /> : <Library />}</span>}
      <span><b>{asset.name}</b><small>{promptAssetLabel(asset, assets.some((item) => item.id === asset.id) ? assets : [...assets, asset])}</small></span><Check />
    </button>) : <div className="mention-pop__state">{libraryError ? "资产读取失败，再次输入 @ 即可重试" : "没有匹配的可用资产"}</div>}</div>
    <footer>↑↓ 选择　Enter 插入　Esc 关闭</footer>
  </div>, document.body);

  return <div className="prompt-editor-wrap"><div ref={editor} className="prompt-editor" contentEditable role="textbox" aria-multiline="true" aria-label="创作提示词" data-placeholder={placeholder} suppressContentEditableWarning onInput={() => { sync(); detectMention(); }} onKeyUp={(event) => !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key) && detectMention()} onKeyDown={keyDown} onBlur={(event) => { clearEditorSelection(event.currentTarget); window.setTimeout(() => setOpen(false), 120); }} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }} />{popup}</div>;
}
