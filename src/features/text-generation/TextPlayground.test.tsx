// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { textModelCatalog } from "../../../server/text-model-catalog";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), stream: vi.fn(), get: vi.fn() }));
vi.mock("./text-cache", () => ({ readTextDraft: mocks.read, saveTextDraft: mocks.save }));
vi.mock("./text-client", () => ({ streamText: mocks.stream }));
vi.mock("../../api", () => ({ api: { get: mocks.get } }));
import { TextPlayground } from "./TextPlayground";

let host: HTMLDivElement;
let root: Root;
const chooseMedia = vi.fn();
const onSubmitted = vi.fn();
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue({ items: textModelCatalog(), configured: true });
  mocks.stream.mockResolvedValue("stop");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); host.className = "workspace"; document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(compact = false) {
  await act(async () => { root.render(<TextPlayground userId="user" sessionId="session" compact={compact} chooseMedia={chooseMedia} onSubmitted={onSubmitted} />); });
}
it("uses the existing empty Composer shell, control row and circular icon-only send button", async () => {
  await render();
  expect(host.querySelector(".empty-workspace > .composer > .composer-shell .prompt-row--text .prompt-editor")).toBeTruthy();
  expect(host.querySelector("h1")?.textContent).toBe("今晚，想创造什么？");
  const send = host.querySelector<HTMLButtonElement>(".control-row .send-button")!;
  expect(send.textContent).toBe(""); expect(send.disabled).toBe(true);
  expect(host.querySelector("select")).toBeNull();
  expect(host.querySelector("input[type=file]")).toBeNull();
  expect(mocks.stream).not.toHaveBeenCalled();
});
it("uses the original dock when switching out of an existing media conversation", async () => {
  await render(true);
  expect(host.querySelector(".conversation .composer-dock .composer--compact .composer-shell")).toBeTruthy();
  expect(host.querySelector(".empty-workspace")).toBeNull();
});
it("restores raw text, preserves blank lines on submit, and shows results above the shared dock", async () => {
  const prompt = "  原始输入\n\n\n\n保留空行 🙂  ";
  mocks.read.mockResolvedValue({ prompt, model: "openai/gpt-5.6-sol", records: [] });
  await render();
  expect(host.querySelector("textarea")?.value).toBe(prompt);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="生成文本"]')!.click());
  expect(mocks.stream.mock.calls[0][0]).toMatchObject({ prompt });
  expect(host.querySelector(".conversation-inner .text-result")).toBeTruthy();
  expect(host.querySelector(".composer-dock .prompt-editor")).toBeTruthy();
  expect(host.querySelector("textarea")?.value).toBe(prompt);
});
it("shares the video/image/text menu, closes on Escape, and routes back to the chosen media engine", async () => {
  await render();
  const trigger = host.querySelector<HTMLButtonElement>(".control--accent")!;
  await act(async () => trigger.click());
  expect([...host.querySelectorAll(".generation-pop b")].map((node) => node.textContent)).toEqual(["视频生成", "图片生成", "文本生成"]);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector(".generation-pop")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  await act(async () => host.querySelectorAll<HTMLButtonElement>(".generation-pop button")[1].click());
  expect(chooseMedia).toHaveBeenCalledWith("image");
});
