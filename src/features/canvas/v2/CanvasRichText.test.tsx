// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasRichText } from "./CanvasRichText";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const [expanded, setExpanded] = useState(false);
  return <CanvasRichText value="" readOnly={false} expanded={expanded} onExpandedChange={setExpanded} onChange={() => undefined} />;
}

const legacyEmptyState = {
  root: {
    children: [],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
};

describe("CanvasRichText expanded editor", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens a portal dialog when the workspace keeps expanded state", async () => {
    await act(async () => root.render(<Harness />));
    const expand = document.querySelector<HTMLButtonElement>('button[title="放大编辑"]');
    expect(expand).not.toBeNull();

    await act(async () => expand?.click());
    expect(document.querySelector('[role="dialog"][aria-label="放大编辑文本"]')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('button[title="退出放大编辑"]')).not.toBeNull();
  });

  it("recovers a legacy empty serialized state from its Markdown mirror", async () => {
    await act(async () => root.render(
      <CanvasRichText
        value="旧画布里的镜头说明"
        richText={legacyEmptyState}
        readOnly={false}
        expanded={false}
        onExpandedChange={() => undefined}
        onChange={() => undefined}
      />,
    ));

    expect(document.querySelector('[contenteditable="true"]')?.textContent).toContain("旧画布里的镜头说明");
  });
});
