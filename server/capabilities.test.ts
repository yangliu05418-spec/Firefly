import { describe, expect, it } from "vitest";
import { MODELS } from "./capabilities.js";
import { buildProviderPayload, validateGeneration } from "./provider.js";

const base = { prompt: "雨夜城市的微距镜头", model: "dreamina-seedance-2-5-260628", mode: "text", ratio: "16:9", resolution: "720p", duration: 4, generateAudio: true, seed: -1, cameraFixed: false, watermark: false, outputFormat: "mp4", assets: [] };

describe("Seedance capability registry", () => {
  it("contains every supported production model", () => expect(MODELS).toHaveLength(7));
  it("allows the current Seedance 2.5 baseline", () => expect(validateGeneration(base).model).toBe(base.model));
  it("allows the documented Seedance 2.5 1080p output", () => {
    const input = validateGeneration({ ...base, resolution: "1080p" });
    expect(buildProviderPayload(input)).toMatchObject({ model: base.model, resolution: "1080p" });
  });
  it("rejects undocumented Seedance 2.5 resolution tiers", () => expect(() => validateGeneration({ ...base, resolution: "4k" })).toThrow("清晰度"));
  it("rejects audio-only input on Seedance 2.0", () => expect(() => validateGeneration({ ...base, prompt: "", model: "dreamina-seedance-2-0-260128", mode: "omni", assets: [{ id: "a", name: "voice.wav", type: "audio", role: "reference_audio", url: "https://example.com/voice.wav" }] })).toThrow("仅使用音频"));
  it("requires both first and last frames", () => expect(() => validateGeneration({ ...base, mode: "first_last", assets: [] })).toThrow("首帧和一张尾帧"));
  it("normalizes cached Seedance 2.5 first-frame requests to adaptive ratio", () => expect(validateGeneration({ ...base, mode: "first_frame", assets: [{ id: "i", name: "first.png", type: "image", role: "first_frame", url: "https://example.com/first.png" }] }).ratio).toBe("adaptive"));
  it("maps Seedance 2.5 editing to the documented task hint", () => {
    const input = validateGeneration({ ...base, mode: "edit", ratio: "adaptive", duration: -1, assets: [{ id: "v", name: "source.mp4", type: "video", role: "reference_video", url: "https://example.com/source.mp4" }] });
    expect(buildProviderPayload(input)).toMatchObject({ ratio: "adaptive", duration: -1, omni_reference_task_type: "edit" });
  });
  it("marks Seedance 2.5 omni video references without changing framing", () => {
    const input = validateGeneration({ ...base, mode: "omni", ratio: "16:9", duration: 15, assets: [{ id: "v", name: "source.mp4", type: "video", role: "reference_video", url: "https://example.com/source.mp4" }] });
    expect(buildProviderPayload(input)).toMatchObject({ ratio: "16:9", duration: 15, omni_reference_task_type: "reference" });
  });
  it("normalizes cached Seedance 2.5 edit parameters", () => {
    const input = validateGeneration({ ...base, mode: "edit", ratio: "16:9", duration: 15, assets: [{ id: "v", name: "source.mp4", type: "video", role: "reference_video", url: "https://example.com/source.mp4" }] });
    expect(buildProviderPayload(input)).toMatchObject({ ratio: "adaptive", duration: -1, omni_reference_task_type: "edit" });
  });
  it("keeps Seedance 2.0 editing on its documented fixed duration path", () => {
    const input = validateGeneration({ ...base, model: "dreamina-seedance-2-0-260128", mode: "edit", duration: 5, assets: [{ id: "v", name: "source.mp4", type: "video", role: "reference_video", url: "https://example.com/source.mp4" }] });
    expect(buildProviderPayload(input)).not.toHaveProperty("omni_reference_task_type");
  });
  it("rejects reference assets in text-to-video mode", () => expect(() => validateGeneration({ ...base, assets: [{ id: "i", name: "ref.png", type: "image", role: "reference_image", url: "https://example.com/ref.png" }] })).toThrow("不接受参考素材"));
  it("omits camera_fixed from text-to-video payloads", () => {
    const input = validateGeneration({ ...base, model: "dreamina-seedance-2-0-mini-260615", generateAudio: false, cameraFixed: true });
    expect(buildProviderPayload(input)).not.toHaveProperty("camera_fixed");
  });
  it("blocks an unresolved internal reference marker at the provider boundary", () => {
    expect(() => buildProviderPayload({ ...validateGeneration(base), prompt: "使用 [[firefly-ref:missing]]" })).toThrow("未解析");
  });
  it("rejects media whose role does not match its type", () => {
    expect(() => validateGeneration({ ...base, mode: "omni", assets: [{ id: "bad", name: "wrong.mp4", type: "video", role: "reference_image", url: "https://example.com/wrong.mp4" }] })).toThrow("类型与引用角色");
  });
  it("does not expose audio generation on Seedance 1.0", () => expect(() => validateGeneration({ ...base, model: "seedance-1-0-pro-250528" })).toThrow("不支持生成音频"));
});
