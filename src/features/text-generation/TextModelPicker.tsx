import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { TEXT_PROVIDERS, type TextModel } from "../../../server/text-model-catalog";

export function TextModelPicker({ models, selected, choose, close }: { models: TextModel[]; selected: string; choose: (model: string) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const filtered = useMemo(() => models.filter((model) => (!provider || model.provider === provider) && `${model.id} ${model.name} ${model.providerName}`.toLowerCase().includes(search.trim().toLowerCase())), [models, search, provider]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    searchInput.current?.focus();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="text-model-picker" aria-labelledby="text-model-title" onCancel={close} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
    <header><div><h2 id="text-model-title">选择文本模型</h2><p>通过 OpenRouter 连接 · {models.length} 个模型</p></div><button aria-label="关闭模型选择" onClick={close}><X /></button></header>
    <div className="text-model-picker__filters"><label><Search /><input ref={searchInput} autoFocus aria-label="搜索文本模型" placeholder="搜索名称或模型 ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="按供应商筛选" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">所有供应商</option>{Object.entries(TEXT_PROVIDERS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
    <div className="text-model-picker__list" aria-label="文本模型列表">{Object.entries(TEXT_PROVIDERS).map(([id, name]) => {
      const group = filtered.filter((model) => model.provider === id);
      return group.length ? <section key={id}><h3>{name}</h3>{group.map((model) => <button key={model.id} aria-pressed={model.id === selected} disabled={!model.available} onClick={() => { choose(model.id); close(); }}><span><b>{model.name}</b><small>{model.id}{!model.available ? " · 暂不可用" : ""}</small></span>{model.id === selected && <Check />}</button>)}</section> : null;
    })}{!filtered.length && <p className="text-model-picker__empty">没有匹配的模型，请调整搜索或供应商。</p>}</div>
  </dialog>;
}
