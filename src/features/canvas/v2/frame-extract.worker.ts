import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from "mediabunny";

type ExtractMessage = { url: string; timestamp: number };
type WorkerPort = { onmessage: ((event: MessageEvent<ExtractMessage>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
const port = globalThis as unknown as WorkerPort;

port.onmessage = (event) => {
  void (async () => {
    if (!globalThis.VideoDecoder || !globalThis.OffscreenCanvas) throw new Error("当前浏览器不支持视频抽帧，请升级到最新 Chrome 或 Edge");
    const input = new Input({ source: new UrlSource(new URL(event.data.url, location.origin), { requestInit: { credentials: "same-origin" }, maxCacheSize: 24 * 1024 * 1024, parallelism: 2 }), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("视频素材缺少可解码的视频轨");
      const sample = await new VideoSampleSink(track).getSample(Math.max(0, event.data.timestamp));
      if (!sample) throw new Error("无法读取所选时间点的视频帧");
      try {
        const scale = Math.min(1, 1920 / Math.max(sample.displayWidth, sample.displayHeight));
        const width = Math.max(1, Math.round(sample.displayWidth * scale));
        const height = Math.max(1, Math.round(sample.displayHeight * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("无法创建抽帧画布");
        sample.draw(context, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: "image/webp", quality: .92 });
        const buffer = await blob.arrayBuffer();
        port.postMessage({ type: "complete", buffer, width, height }, [buffer]);
      } finally { sample.close(); }
    } finally { input.dispose(); }
  })().catch((error) => port.postMessage({ type: "error", message: error instanceof Error ? error.message : "视频抽帧失败" }));
};
