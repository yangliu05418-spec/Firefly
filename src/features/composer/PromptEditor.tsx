import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, Library, LoaderCircle, Video } from "lucide-react";
import { api } from "../../api";
import { useAssetCacheUserId } from "../../asset-cache-context";
import { createPromptAssetToken, focusPromptEditorAtEnd, promptNodeText, refreshPromptAssetTokens, renderPromptValue } from "../../prompt-editor-dom";
import { loadPromptLibraryCacheFirst } from "../../prompt-library-cache";
import { promptAssetLabel, referenceBindingId } from "../../prompt-references";
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
  characterCount: number;
  characterLimit: number;
};

export function PromptEditor({ value, placeholder, assets, disabled, attach, change, focusSignal, characterCount, characterLimit }: PromptEditorProps) {
  const userId = useAssetCacheUserId();
  const editor = useRef<HTMLDivElement>(null); const mentionRange = useRef<Range | null>(null);
  const renderedRestoreSignal = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [active, setActive] = useState(0); const [anchor, setAnchor] = useState({ left: 12, top: 12, above: false });
  const [library, setLibrary] = useState<UploadAsset[]>([]); const [libraryLoading, setLibraryLoading] = useState(false); const [libraryError, setLibraryError] = useState(false); const loadedLibrary = useRef(false); const libraryRequest = useRef(0);
  const sync = () => {
    if (!editor.current) return "";
    const next = Array.from(editor.current.childNodes).map(promptNodeText).join("").replace(/\n{3,}/g, "\n\n");
    change(next);
    return next;
  };
  const candidates = useMemo(() => {
    const ready = assets.filter((asset) => asset.progress === 100);
    const merged = [...ready, ...library.filter((candidate) => !ready.some((asset) => asset.id === candidate.id))];
    const term = query.trim().toLocaleLowerCase();
    return (term ? merged.filter((asset) => asset.name.toLocaleLowerCase().includes(term) || promptAssetLabel(asset, merged).toLocaleLowerCase().includes(term)) : merged).slice(0, 30);
  }, [assets, library, query]);

  useLayoutEffect(() => {
    const node = editor.current;
    if (!node) return;
    const isNewRestore = focusSignal !== undefined && renderedRestoreSignal.current !== focusSignal;
    const rendered = Array.from(node.childNodes).map(promptNodeText).join("").replace(/\n{3,}/g, "\n\n");
    const staleToken = Array.from(node.querySelectorAll<HTMLElement>("[data-asset-id]")).some((token) => {
      const asset = assets.find((candidate) => referenceBindingId(candidate) === token.dataset.assetId || candidate.id === token.dataset.assetId);
      const image = token.querySelector<HTMLImageElement>("img");
      return token.title !== (asset?.name ?? "正在恢复素材")
        || Boolean(image) !== Boolean(asset?.preview)
        || Boolean(asset?.preview && image?.getAttribute("src") !== asset.preview);
    });
    if (isNewRestore || document.activeElement !== node) {
      if (rendered !== value || staleToken) renderPromptValue(node, value, assets);
    } else if (staleToken) refreshPromptAssetTokens(node, assets);
    if (isNewRestore) {
      renderedRestoreSignal.current = focusSignal;
      focusPromptEditorAtEnd(node);
    }
  }, [value, assets, focusSignal]);
  useLayoutEffect(() => {
    if (!editor.current) return;
    const attached = new Set(assets.map(referenceBindingId)); let removed = false;
    editor.current.querySelectorAll<HTMLElement>("[data-asset-id]").forEach((token) => { if (!attached.has(token.dataset.assetId ?? "")) { token.remove(); removed = true; } });
    if (removed) {
      sync();
      if (document.activeElement === editor.current) focusPromptEditorAtEnd(editor.current);
    }
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
    const token = createPromptAssetToken(asset, referenceBindingId(asset));
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

  const countState = characterCount > characterLimit ? "error" : characterCount >= characterLimit * .9 ? "warning" : "normal";
  return <div className="prompt-editor-wrap"><div ref={editor} className="prompt-editor" contentEditable role="textbox" aria-multiline="true" aria-label="创作提示词" aria-invalid={countState === "error" || undefined} data-placeholder={placeholder} suppressContentEditableWarning onFocus={(event) => { if (!Array.from(event.currentTarget.childNodes).map(promptNodeText).join("")) focusPromptEditorAtEnd(event.currentTarget); }} onInput={() => { sync(); detectMention(); }} onKeyUp={(event) => !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key) && detectMention()} onKeyDown={keyDown} onBlur={(event) => { if (!Array.from(event.currentTarget.childNodes).map(promptNodeText).join("")) event.currentTarget.replaceChildren(); clearEditorSelection(event.currentTarget); window.setTimeout(() => setOpen(false), 120); }} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }} /><output className={`prompt-character-count prompt-character-count--${countState}`} aria-live="polite">{characterCount.toLocaleString()} / {characterLimit.toLocaleString()}</output>{popup}</div>;
}
