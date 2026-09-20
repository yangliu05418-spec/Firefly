import { useEffect, useRef } from "react";
import { Check, ChevronDown, Film, ImageIcon, Type, WandSparkles } from "lucide-react";

type CreationEngine = "video" | "image" | "text";
const choices = [
  { id: "video", label: "视频生成", note: "使用 Seedance 生成或编辑视频", Icon: Film },
  { id: "image", label: "图片生成", note: "支持文生图与图生图", Icon: ImageIcon },
  { id: "text", label: "文本生成", note: "单轮输入，流式输出", Icon: Type },
] as const;

export function CreationTypeControl({ value, open, setOpen, choose, allowText = true }: {
  value: CreationEngine; open: boolean; setOpen: (open: boolean) => void;
  choose: (engine: CreationEngine) => void; allowText?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, setOpen]);
  return <div className="control-wrap" ref={root}>
    <button ref={trigger} className="control control--accent" aria-expanded={open} onClick={() => setOpen(!open)}>
      <WandSparkles /> {choices.find((choice) => choice.id === value)?.label} <ChevronDown />
    </button>
    {open && <div className="popover mode-pop generation-pop" onClick={(event) => event.stopPropagation()}>
      <p>选择创作类型</p>
      {choices.filter((choice) => allowText || choice.id !== "text").map(({ id, label, note, Icon }) =>
        <button key={id} className={value === id ? "selected" : ""} aria-pressed={value === id} onClick={() => { setOpen(false); choose(id); }}>
          <span className="model-icon"><Icon /></span><span><b>{label}</b><small>{note}</small></span>{value === id && <Check />}
        </button>)}
    </div>}
  </div>;
}
