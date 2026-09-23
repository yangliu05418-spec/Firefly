import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { probePreviewSource } from "./preview-integrity.js";
import { deleteObject, headObject, streamObjectToTos } from "./tos.js";
import { transcodePreviewFromUrl } from "./preview-transcode.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("./preview-integrity.js", async (actual) => ({ ...await actual<object>(), probePreviewSource: vi.fn() }));
vi.mock("./tos.js", () => ({
  abortIncompleteUploadsForKey: vi.fn().mockResolvedValue(0), deleteObject: vi.fn().mockResolvedValue(undefined),
  headObject: vi.fn(), signedObjectUrl: vi.fn(() => "https://tos.test/preview"),
  streamObjectToTos: vi.fn(), transcodeVideoOnTos: vi.fn(), verifyProgressiveMp4: vi.fn().mockResolvedValue({}),
}));

const source = { duration: 30, codec: "h264", pixelFormat: "yuv420p", width: 720, height: 1280, bitrate: 2_000_000, audioCodecs: ["aac"] };
describe("preview encoder/upload lifecycle", () => {
  beforeEach(() => {
    vi.mocked(headObject).mockRejectedValue(Object.assign(new Error("missing"), { statusCode: 404 }));
    vi.mocked(probePreviewSource).mockResolvedValue(source);
  });
  afterEach(() => vi.clearAllMocks());
  const child = () => {
    const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false, kill: vi.fn() });
    process.kill.mockImplementation(() => { process.killed = true; process.emit("close", null, "SIGKILL"); return true; });
    vi.mocked(spawn).mockReturnValue(process as never);
    return process;
  };

  it("waits for a cancelled late upload before cleanup; no post-cleanup resurrection", async () => {
    const process = child();
    let finishUpload!: () => void;
    vi.mocked(streamObjectToTos).mockImplementation(async (_key, _source, _name, _type, _part, _size, producer) => {
      await new Promise<void>((resolve) => { finishUpload = resolve; });
      producer!.signal!.throwIfAborted();
      return {} as never;
    });
    const running = transcodePreviewFromUrl("https://provider.test/source", "preview");
    const rejected = expect(running).rejects.toThrow(/转码失败/);
    await vi.waitFor(() => expect(streamObjectToTos).toHaveBeenCalledOnce());
    process.emit("close", null, "SIGKILL");
    await Promise.resolve();
    expect(deleteObject).not.toHaveBeenCalled();
    finishUpload();
    await rejected;
    expect(deleteObject).toHaveBeenCalledOnce();
  });
  it("does not reuse an old valid-MP4 header containing only two seconds", async () => {
    const process = child();
    vi.mocked(headObject).mockResolvedValue({} as never);
    vi.mocked(probePreviewSource).mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, duration: 2 }).mockResolvedValue(source);
    vi.mocked(streamObjectToTos).mockImplementation(async (_key, _source, _name, _type, _part, _size, producer) => {
      process.emit("close", 0);
      await producer!.beforeComplete!();
      return {} as never;
    });
    await transcodePreviewFromUrl("https://provider.test/source", "preview");
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
    expect(vi.mocked(spawn).mock.calls[0]![1]).toContain("copy");
    expect(probePreviewSource).toHaveBeenCalledTimes(3);
  });
});
