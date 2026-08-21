// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageRetrySource, RecoveringImage, RecoveringThumbnail } from "./recovering-image";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("recovering private images", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  it("only adds retry tokens to stable same-origin API routes", () => {
    expect(imageRetrySource("/api/assets/asset-1/source?variant=thumbnail", 2, "https://firefly.example"))
      .toBe("/api/assets/asset-1/source?variant=thumbnail&_ff_retry=2");
    expect(imageRetrySource("https://tos.example/signed.mp4?token=secret", 2, "https://firefly.example"))
      .toBe("https://tos.example/signed.mp4?token=secret");
  });

  it("retries after 2 and 6 seconds, then exposes a manual recovery action", async () => {
    const root = createRoot(container);
    await act(async () => { root.render(<RecoveringImage src="/api/assets/asset-1/source?variant=thumbnail" alt="asset" fallback={({ phase, retry }) => <button onClick={retry}>{phase}</button>} />); });

    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });
    expect(container.textContent).toBe("retrying");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(container.querySelector("img")?.getAttribute("src")).toContain("_ff_retry=1");

    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(container.querySelector("img")?.getAttribute("src")).toContain("_ff_retry=2");

    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });
    expect(container.textContent).toBe("failed");
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); });
    expect(container.querySelector("img")?.getAttribute("src")).toContain("_ff_retry=10");
    await act(async () => root.unmount());
  });

  it("resets immediately when the source changes", async () => {
    const root = createRoot(container);
    const fallback = ({ phase }: { phase: "retrying" | "failed" }) => <span>{phase}</span>;
    await act(async () => { root.render(<RecoveringImage src="/api/assets/one/source" alt="one" fallback={fallback} retryDelays={[]} />); });
    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });
    expect(container.textContent).toBe("failed");
    await act(async () => { root.render(<RecoveringImage src="/api/assets/two/source" alt="two" fallback={fallback} retryDelays={[]} />); });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/assets/two/source");
    await act(async () => root.unmount());
  });

  it("does not create a nested interactive control inside asset buttons", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<button type="button"><RecoveringThumbnail src="/api/assets/asset-1/source?variant=thumbnail" alt="测试素材" manualRecovery={false} /></button>);
    });
    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    await act(async () => { container.querySelector("img")?.dispatchEvent(new Event("error")); });

    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("[role=button]")).toBeNull();
    expect(container.querySelector("[role=status]")?.getAttribute("aria-label")).toBe("测试素材暂时无法载入");
    await act(async () => root.unmount());
  });
});
