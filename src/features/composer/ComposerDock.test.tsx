// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ComposerDock } from "./ComposerDock";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("tracks growth and shrinkage including the bottom offset, then restores page scrolling on exit", () => {
  let resize = () => undefined as void;
  let top = 600;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal("innerHeight", 900);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
  const host = document.createElement("div"); host.className = "workspace"; document.body.append(host);
  document.documentElement.style.scrollPaddingBottom = "9px";
  const root = createRoot(host);
  try {
    act(() => root.render(<ComposerDock><input defaultValue="草稿" /></ComposerDock>));
    expect(host.style.getPropertyValue("--composer-clearance")).toBe("324px");
    top = 420; resize();
    expect(host.style.getPropertyValue("--composer-clearance")).toBe("504px");
    top = 710; window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.scrollPaddingBottom).toBe("214px");
    expect(host.querySelector("input")?.value).toBe("草稿");
  } finally {
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
    expect(host.style.getPropertyValue("--composer-clearance")).toBe("");
    expect(document.documentElement.style.scrollPaddingBottom).toBe("9px");
    host.remove(); document.documentElement.style.scrollPaddingBottom = "";
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
