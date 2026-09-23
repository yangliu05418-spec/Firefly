import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcodePreviewFromUrl } from "./preview-transcode.js";
import { probePreviewSource } from "./preview-integrity.js";
import { signedObjectUrl, streamObjectToTos } from "./tos.js";

vi.mock("./tos.js", () => ({
  abortIncompleteUploadsForKey: vi.fn().mockResolvedValue(0), deleteObject: vi.fn().mockResolvedValue(undefined),
  headObject: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { statusCode: 404 })),
  signedObjectUrl: vi.fn(), streamObjectToTos: vi.fn(), transcodeVideoOnTos: vi.fn(),
  verifyProgressiveMp4: vi.fn().mockResolvedValue({}),
}));

const execute = promisify(execFile);
const available = spawnSync("ffmpeg", ["-version"], { timeout: 5000 }).status === 0;
describe.skipIf(!available)("real FFmpeg producer and duration validation", () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); vi.clearAllMocks(); });
  it.each(["libx264", "mpeg4"])("preserves full video duration through the %s source pipeline", async (codec) => {
    directory = await mkdtemp(path.join(tmpdir(), "firefly-preview-test-"));
    const source = path.join(directory, "source.mp4");
    const target = path.join(directory, "preview.mp4");
    await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24", "-t", "3", "-c:v", codec, "-pix_fmt", "yuv420p", source], { timeout: 15000 });
    vi.mocked(signedObjectUrl).mockReturnValue(target);
    vi.mocked(streamObjectToTos).mockImplementation(async (_key, bytes, _name, _type, _part, _size, producer) => {
      const chunks: Buffer[] = [];
      for await (const chunk of bytes) chunks.push(Buffer.from(chunk));
      await producer!.beforeComplete!();
      producer!.signal!.throwIfAborted();
      await writeFile(target, Buffer.concat(chunks));
      return {} as never;
    });
    await transcodePreviewFromUrl(source, "test-preview");
    const preview = await probePreviewSource(target);
    expect(preview.codec).toBe("h264");
    expect(preview.duration).toBeCloseTo(3, 1);
    expect((await readFile(target)).length).toBeGreaterThan(1000);
  }, 30_000);
});
