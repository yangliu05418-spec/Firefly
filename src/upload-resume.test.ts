import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadFile } from "./api";
import { putUploadPart } from "./upload-transport";
vi.mock("./upload-transport", () => ({ putUploadPart: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("direct upload recovery", () => {
  it("reconciles a lost PUT response instead of sending the part again", async () => {
    vi.mocked(putUploadPart).mockRejectedValue(new Error("response lost"));
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") return json({ id: "recover", direct: true, chunkSize: 16, parts: [{ partNumber: 1, url: "https://tos.test/part" }] });
      if (url.endsWith("/parts")) return json({ parts: [{ partNumber: 1, eTag: "saved" }] });
      if (url.endsWith("/complete")) { expect(JSON.parse(String(init?.body)).parts).toEqual([{ partNumber: 1, eTag: "saved" }]); return json({ id: "recover", state: "ready" }); }
      throw Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadFile(new File(["video"], "a.mp4", { type: "video/mp4" }), "video", vi.fn())).resolves.toMatchObject({ id: "recover" });
    expect(putUploadPart).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("retains the multipart session after failure and resumes only missing parts", async () => {
    vi.useFakeTimers();
    const saved: { partNumber: number; eTag: string }[] = [];
    let recovered = false;
    vi.mocked(putUploadPart).mockImplementation(async (url) => {
      if (url.endsWith("/1")) { saved.push({ partNumber: 1, eTag: "one" }); return { ok: true, status: 200, eTag: "one" }; }
      if (!recovered) throw new Error("offline");
      return { ok: true, status: 200, eTag: "two" };
    });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/uploads") return json({ id: "resume", direct: true, chunkSize: 3, concurrency: 1, parts: [1, 2].map((partNumber) => ({ partNumber, url: `https://tos.test/${partNumber}` })) });
      if (url.endsWith("/parts")) return json({ parts: saved });
      if (url.endsWith("/heartbeat")) return new Response(null, { status: 204 });
      if (url.endsWith("/complete")) { expect(JSON.parse(String(init?.body)).parts).toEqual([{ partNumber: 1, eTag: "one" }, { partNumber: 2, eTag: "two" }]); return json({ id: "resume", state: "ready" }); }
      if (url === "/api/uploads/resume") return json({}, 404);
      throw Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const file = new File(["123456"], "a.mp4", { type: "video/mp4" });
    const failed = expect(uploadFile(file, "video", vi.fn())).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(10_000); await failed;
    recovered = true;
    await expect(uploadFile(file, "video", vi.fn())).resolves.toMatchObject({ id: "resume" });
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/uploads")).toHaveLength(1);
    expect(vi.mocked(putUploadPart).mock.calls.filter(([url]) => url.endsWith("/1"))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});
