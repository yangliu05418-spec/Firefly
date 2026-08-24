import { expect, test, type Page, type Route } from "@playwright/test";
import type { CanvasProjectAsset } from "../src/features/canvas/canvas-api";
import type { CanvasDocumentV2 } from "../src/features/canvas/canvas-v2-types";

test.describe.configure({ timeout: 60_000 });

const documentV2: CanvasDocumentV2 = { version: 2, viewport: { x: 0, y: 0, k: 1 }, background: "dots", preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false }, nodes: [], connections: [] };
const relationDocument: CanvasDocumentV2 = {
  ...documentV2,
  nodes: [
    { id: "source-text", type: "text", title: "雨夜对白", position: { x: 140, y: 170 }, width: 300, height: 220, data: { markdown: "镜头从雨中的背影开始。", status: "idle" } },
    { id: "target-image", type: "image", title: "镜头草图", position: { x: 570, y: 170 }, width: 320, height: 300, data: { projectAssetId: "project-target", status: "succeeded" } },
  ],
  connections: [{ id: "edge-context", source: "source-text", target: "target-image", sourceHandle: "right", targetHandle: "left", relation: "context" }],
};
const emptyMediaDocument: CanvasDocumentV2 = {
  ...documentV2,
  nodes: [
    { id: "empty-image", type: "image", title: "空图片", position: { x: 240, y: 100 }, width: 320, height: 300, data: { status: "idle" } },
    { id: "empty-character", type: "character", title: "空角色", position: { x: 700, y: 100 }, width: 320, height: 300, data: { status: "idle" } },
    { id: "empty-video", type: "video", title: "空视频", position: { x: 240, y: 540 }, width: 320, height: 300, data: { status: "idle" } },
    { id: "empty-scene", type: "scene", title: "空场景", position: { x: 700, y: 540 }, width: 320, height: 300, data: { status: "idle" } },
  ],
  connections: [],
};
const interruptedUploadDocument: CanvasDocumentV2 = {
  ...documentV2,
  nodes: [
    { id: "interrupted-image", type: "image", title: "未完成上传.png", position: { x: 240, y: 100 }, width: 320, height: 300, data: { status: "running", mimeType: "image/png" } },
  ],
  connections: [],
};
const projectImageAsset: CanvasProjectAsset = {
  id: "project-library-image", canvasId: "canvas-e2e", kind: "image", title: "常用角色参考", contentType: "image/png", size: 128,
  width: 512, height: 512, status: "ready", createdAt: 1, updatedAt: 1,
  mediaUrl: "/api/canvas-project-assets/project-library-image/media", downloadUrl: "/api/canvas-project-assets/project-library-image/media?download=1",
};
const videoModels = [{ id: "dreamina-seedance-2-5-260628", name: "Seedance 2.5", note: "旗舰模型", modes: ["omni", "text"], resolutions: ["720p", "1080p"], ratios: ["adaptive", "16:9", "9:16"], duration: [4, 30], imageLimit: 30, videoLimit: 10, audioLimit: 10, audioOnly: true, supportsAudio: true, outputFormats: ["mp4"] }];
const imageModels = [{ id: "google/gemini-3.1-flash-lite-image", name: "Nano Banana 2 Lite", resolutions: ["1024"], defaultResolution: "1024", maxCount: 4, maxReferences: 4 }];

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockAuthenticatedApi(page: Page, options: {
  leaseHeld?: boolean; expireLeaseOnce?: boolean; document?: CanvasDocumentV2; imageGenerationDelayMs?: number; projectAssets?: CanvasProjectAsset[];
  creationSessions?: Array<{ id: string; title: string; createdAt: number; updatedAt: number }>;
  imageHistory?: Array<Record<string, unknown>>; videoHistory?: Array<Record<string, unknown>>; imageSessionFailures?: string[]; holdGenerationAdmission?: boolean; generationAdmissionResponseLost?: boolean; creationSessionAdmissionResponseLost?: boolean;
  authSessionFailures?: number;
} = {}) {
  let revision = 0;
  let storedDocument = structuredClone(options.document ?? documentV2);
  let leaseReleaseCount = 0;
  let imageHistory: Array<Record<string, unknown>> = structuredClone(options.imageHistory ?? []);
  let videoHistory: Array<Record<string, unknown>> = structuredClone(options.videoHistory ?? []);
  let creationSessions = structuredClone(options.creationSessions ?? [{ id: "session-e2e", title: "新创作", createdAt: Date.now(), updatedAt: Date.now() }]);
  const postedSessionRequests: string[] = [];
  const fallbackSessionSources: string[] = [];
  const postedGenerations: Array<Record<string, unknown>> = [];
  let releaseGenerationAdmission: () => void = () => undefined;
  const generationAdmissionGate = options.holdGenerationAdmission
    ? new Promise<void>((resolve) => { releaseGenerationAdmission = resolve; })
    : Promise.resolve();
  let leasePostCount = 0;
  let leaseRenewCount = 0;
  const saveLeaseTokens: string[] = [];
  const postedJobs: Array<{ kind: string; nodeId: string; revision: number }> = [];
  let projectAssets = structuredClone(options.projectAssets ?? []);
  let uploadCount = 0;
  let authSessionRequests = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/auth/session") {
      authSessionRequests += 1;
      if (authSessionRequests <= (options.authSessionFailures ?? 0)) return json(route, { error: "session service unavailable" }, 503);
      return json(route, { authenticated: true, user: { id: "user-e2e", email: "artist@dokuai.tv", name: "Artist", avatarUrl: "" } });
    }
    if (path === "/api/models") return json(route, videoModels);
    if (path === "/api/image-models") return json(route, { Items: imageModels, Ratios: ["16:9", "1:1", "9:16"], DefaultModel: imageModels[0].id });
    if (path === "/api/creation-sessions" && request.method() === "GET") return json(route, creationSessions);
    if (path === "/api/creation-sessions" && request.method() === "POST") {
      const body = request.postDataJSON() as { requestId?: string };
      const id = body.requestId ?? `session-e2e-${creationSessions.length + 1}`;
      postedSessionRequests.push(id);
      const session = creationSessions.find((item) => item.id === id) ?? { id, title: "新创作", createdAt: Date.now(), updatedAt: Date.now() };
      creationSessions = [session, ...creationSessions.filter((item) => item.id !== id)];
      return options.creationSessionAdmissionResponseLost ? json(route, { error: "response lost" }, 503) : json(route, session, 201);
    }
    if (path.startsWith("/api/creation-sessions/") && request.method() === "GET") {
      const id = decodeURIComponent(path.slice("/api/creation-sessions/".length));
      const session = creationSessions.find((item) => item.id === id);
      return session ? json(route, session) : json(route, { error: "创作会话不存在" }, 404);
    }
    if (path.startsWith("/api/creation-sessions/") && request.method() === "PATCH") {
      const id = decodeURIComponent(path.slice("/api/creation-sessions/".length)); const title = (request.postDataJSON() as { title: string }).title;
      creationSessions = creationSessions.map((session) => session.id === id ? { ...session, title, updatedAt: Date.now() } : session);
      return json(route, creationSessions.find((session) => session.id === id));
    }
    if (path.startsWith("/api/creation-sessions/") && request.method() === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/creation-sessions/".length)); creationSessions = creationSessions.filter((session) => session.id !== id);
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/reedit-sessions" && request.method() === "POST") {
      const body = request.postDataJSON() as { sourceType: "video" | "image"; sourceId: string };
      const sourceKey = `${body.sourceType}:${body.sourceId}`;
      fallbackSessionSources.push(sourceKey);
      const id = `reedit-${body.sourceType}-${body.sourceId}`;
      const existing = creationSessions.find((session) => session.id === id);
      const session = existing ?? { id, title: "重新编辑", createdAt: Date.now(), updatedAt: Date.now() };
      creationSessions = [session, ...creationSessions.filter((item) => item.id !== id)];
      return json(route, session, existing ? 200 : 201);
    }
    if (path === "/api/reedit-events" && request.method() === "POST") return route.fulfill({ status: 204 });
    if (path === "/api/image-generations" && request.method() === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      if (sessionId && options.imageSessionFailures?.includes(sessionId)) return json(route, { error: "image history unavailable" }, 503);
      return json(route, sessionId ? imageHistory.filter((item) => item.sessionId === sessionId) : imageHistory);
    }
    if (/^\/api\/image-generations\/[^/]+$/.test(path) && request.method() === "GET") {
      const task = imageHistory.find((item) => item.id === decodeURIComponent(path.split("/").at(-1)!));
      return task ? json(route, task) : json(route, { error: "图片任务不存在" }, 404);
    }
    if (/^\/api\/image-generations\/[^/]+\/reedit$/.test(path) && request.method() === "GET") {
      const task = imageHistory.find((item) => item.id === decodeURIComponent(path.split("/").at(-2)!));
      if (!task) return json(route, { error: "图片任务不存在" }, 404);
      return json(route, { sourceId: task.id, sourceType: "image", sessionId: task.sessionId, snapshotVersion: 1, recoveryQuality: "exact", sourceSessionStatus: "active", omittedAssets: 0, warnings: [], adjustments: [], state: { engine: "image", prompt: task.prompt, modelId: videoModels[0].id, mode: "omni", ratio: "16:9", resolution: "720p", duration: 4, generateAudio: true, cameraFixed: false, watermark: false, seed: -1, imageModelId: imageModels[0].id, imageRatio: task.ratio, imageResolution: task.resolution, imageCount: task.requestedCount, assets: [] } });
    }
    if (path === "/api/image-generation" && request.method() === "POST") {
      const body = request.postDataJSON() as { requestId: string; sessionId: string; prompt: string; ratio: string; resolution: string; count: number };
      const pending = { id: body.requestId, sessionId: body.sessionId, modelName: imageModels[0].name, ratio: body.ratio, resolution: body.resolution, prompt: body.prompt, requestedCount: body.count, status: "generating", items: [], failed: [], createdAt: Date.now() };
      imageHistory = [pending, ...imageHistory.filter((item) => item.id !== pending.id)];
      setTimeout(() => { imageHistory = imageHistory.map((item) => item.id === pending.id ? { ...pending, status: "succeeded", items: [{ mediaId: "image-e2e" }] } : item); }, options.imageGenerationDelayMs ?? 0);
      return json(route, { Id: body.requestId, Items: [], Model: imageModels[0].id, Ratio: body.ratio, Resolution: body.resolution, Failed: [], Status: "generating" }, 202);
    }
    if (path === "/api/image-media/image-e2e") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#b8d9cf" d="M0 0h8v8H0z"/></svg>' });
    if (path === "/api/generations" && request.method() === "GET") {
      const sessionId = url.searchParams.get("sessionId");
      return json(route, sessionId ? videoHistory.filter((item) => item.sessionId === sessionId) : videoHistory);
    }
    if (path === "/api/generations" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      postedGenerations.push(body);
      const now = Date.now();
      const pending = { id: body.requestId, sessionId: body.sessionId, caseId: body.requestId, ownerId: "user-e2e", visibility: "private", status: "queued", mediaStatus: "none", prompt: body.prompt, model: body.model, mode: body.mode, ratio: body.ratio, resolution: body.resolution, duration: body.duration, createdAt: now, updatedAt: now };
      videoHistory = [pending, ...videoHistory.filter((item) => item.id !== pending.id)];
      await generationAdmissionGate;
      return options.generationAdmissionResponseLost ? json(route, { error: "response lost" }, 503) : json(route, pending, 202);
    }
    if (/^\/api\/generations\/[^/]+$/.test(path) && request.method() === "GET") {
      const task = videoHistory.find((item) => item.id === decodeURIComponent(path.split("/").at(-1)!));
      return task ? json(route, task) : json(route, { error: "任务不存在" }, 404);
    }
    if (/^\/api\/generations\/[^/]+\/reedit$/.test(path) && request.method() === "GET") {
      const task = videoHistory.find((item) => item.id === decodeURIComponent(path.split("/").at(-2)!));
      if (!task) return json(route, { error: "任务不存在" }, 404);
      return json(route, { sourceId: task.id, sourceType: "video", sessionId: task.sessionId, snapshotVersion: 1, recoveryQuality: "exact", sourceSessionStatus: "active", omittedAssets: 0, warnings: [], adjustments: [], state: { engine: "video", prompt: task.editorPrompt ?? task.prompt, modelId: task.model, mode: task.mode, ratio: task.ratio, resolution: task.resolution, duration: task.duration, generateAudio: false, cameraFixed: true, watermark: false, seed: 42, imageModelId: "", imageRatio: "1:1", imageResolution: "", imageCount: 1, assets: [{ id: "reedit-reference", bindingId: "reedit-reference", snapshotReferenceId: "snapshot-reference-e2e", name: "角色参考.png", type: "image", size: 128, role: "reference_image", progress: 100, phase: "ready", preview: "/api/creation-references/snapshot-reference-e2e/source?variant=thumbnail" }] } });
    }
    if (path === "/api/creation-references/snapshot-reference-e2e") return json(route, { id: "snapshot-reference-e2e", bindingId: "reedit-reference", name: "角色参考.png", type: "image", size: 128, state: "ready", preview: "/api/creation-references/snapshot-reference-e2e/source?variant=thumbnail" });
    if (path === "/api/creation-references/snapshot-reference-e2e/source") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#b8d9cf" d="M0 0h8v8H0z"/></svg>' });
    if (path === "/api/assets") return json(route, { Items: [], HasMore: false });
    if (path === "/api/canvas/config") return json(route, { enabled: true });
    if (path === "/api/canvases/canvas-e2e/lease" && request.method() === "POST") {
      leasePostCount += 1;
      if (options.leaseHeld) return json(route, { acquired: false, holder: { clientId: "another-window", acquiredAt: Date.now() }, ttlMs: 20_000 }, 409);
      return json(route, { acquired: true, token: (leasePostCount === 1 ? "e" : "f").repeat(64), ttlMs: 30_000 });
    }
    if (path === "/api/canvases/canvas-e2e/lease") {
      if (request.method() === "PUT") {
        leaseRenewCount += 1;
        if (options.expireLeaseOnce && leaseRenewCount === 1) return json(route, { error: "编辑权已失效" }, 409);
      }
      if (request.method() === "DELETE") leaseReleaseCount += 1;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/uploads" && request.method() === "POST") {
      uploadCount += 1;
      return json(route, { id: `upload-e2e-${uploadCount.toString().padStart(24, "0")}`, chunkSize: 1024 * 1024, direct: false, concurrency: 1 });
    }
    if (/^\/api\/uploads\/upload-e2e-\d+\/chunks$/.test(path) && request.method() === "POST") return route.fulfill({ status: 204 });
    if (/^\/api\/uploads\/upload-e2e-\d+\/complete$/.test(path) && request.method() === "POST") {
      const uploadId = path.split("/")[3]!;
      return json(route, { id: uploadId, uploadId, name: "node-upload.png", type: "image", size: 68, state: "processing" }, 202);
    }
    if (/^\/api\/uploads\/upload-e2e-\d+$/.test(path) && request.method() === "DELETE") return route.fulfill({ status: 204 });
    if (path === "/api/canvases/canvas-e2e/assets") return json(route, { Items: projectAssets, HasMore: false });
    if (path === "/api/canvases/canvas-e2e/media" && request.method() === "POST") {
      const body = request.postDataJSON() as { kind: "upload" | "user_asset"; uploadId?: string; assetId?: string };
      const source = body.kind === "user_asset" ? projectImageAsset : undefined;
      const projectAsset: CanvasProjectAsset = source ?? {
        ...projectImageAsset,
        id: `project-${body.uploadId}`,
        title: "node-upload.png",
        mediaUrl: `/api/canvas-project-assets/project-${body.uploadId}/media`,
        downloadUrl: `/api/canvas-project-assets/project-${body.uploadId}/media?download=1`,
      };
      projectAssets = [projectAsset, ...projectAssets.filter((asset) => asset.id !== projectAsset.id)];
      return json(route, { mediaRef: { source: "project-asset", projectAssetId: projectAsset.id }, projectAsset, title: projectAsset.title, fileName: projectAsset.title, status: projectAsset.status }, 201);
    }
    if (/^\/api\/canvas-project-assets\/[^/]+\/media$/.test(path)) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#b8d9cf" d="M0 0h8v8H0z"/></svg>' });
    if (path === "/api/canvases/canvas-e2e/jobs" && request.method() === "POST") {
      const payload = request.postDataJSON() as { kind: string; nodeId: string; revision: number };
      postedJobs.push(payload);
      return json(route, { id: `job-${postedJobs.length}`, canvasId: "canvas-e2e", nodeId: payload.nodeId, kind: payload.kind, status: "queued", partialText: "", createdAt: Date.now(), updatedAt: Date.now() }, 202);
    }
    if (path === "/api/canvases/canvas-e2e/jobs") return json(route, { Items: [] });
    if (path === "/api/canvases/canvas-e2e/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\n" });
    if (path === "/api/canvases/canvas-e2e" && request.method() === "GET") return json(route, { id: "canvas-e2e", title: "分镜实验", revision, updatedAt: Date.now(), document: storedDocument });
    if (path === "/api/canvases/canvas-e2e" && request.method() === "PUT") {
      const payload = request.postDataJSON() as { document: CanvasDocumentV2 };
      saveLeaseTokens.push(request.headers()["x-canvas-lease"] ?? "");
      storedDocument = structuredClone(payload.document);
      revision += 1;
      return json(route, { id: "canvas-e2e", title: "分镜实验", revision, updatedAt: Date.now(), document: payload.document });
    }
    if (path === "/api/canvases/canvas-e2e" && request.method() === "PATCH") return json(route, { id: "canvas-e2e", title: "分镜实验" });
    return json(route, { error: `Unhandled E2E route: ${request.method()} ${path}` }, 404);
  });
  return {
    leaseReleaseCount: () => leaseReleaseCount,
    leasePostCount: () => leasePostCount,
    leaseRenewCount: () => leaseRenewCount,
    saveLeaseTokens: () => [...saveLeaseTokens],
    postedJobs: () => [...postedJobs],
    postedGenerations: () => [...postedGenerations],
    releaseGenerationAdmission,
    postedSessionRequests: () => [...postedSessionRequests],
    fallbackSessionSources: () => [...fallbackSessionSources],
    authSessionRequests: () => authSessionRequests,
    creationSessions: () => structuredClone(creationSessions),
    storedDocument: () => structuredClone(storedDocument),
  };
}

test("landing keeps the restrained Firefly entrance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /开始创作/ })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("studio recovers transient session bootstrap failures without showing a false logout", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__feishuLoginSeen", { value: false, writable: true });
    const inspect = () => {
      if (document.body?.innerText.includes("使用飞书企业账号登录")) (window as typeof window & { __feishuLoginSeen: boolean }).__feishuLoginSeen = true;
    };
    addEventListener("DOMContentLoaded", () => {
      inspect();
      new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true, characterData: true });
    }, { once: true });
  });
  const mock = await mockAuthenticatedApi(page, { authSessionFailures: 2 });

  await page.goto("/studio");

  await expect(page.locator(".prompt-editor")).toBeVisible({ timeout: 30_000 });
  await expect.poll(mock.authSessionRequests).toBe(3);
  expect(await page.evaluate(() => (window as typeof window & { __feishuLoginSeen: boolean }).__feishuLoginSeen)).toBe(false);
});

test("completed creation can be loaded back into the composer without a page refresh", async ({ page }) => {
  const createdAt = Date.now() - 60_000;
  await mockAuthenticatedApi(page, { videoHistory: [{
    id: "video-reedit-e2e", sessionId: "session-e2e", caseId: "video-reedit-e2e", visibility: "private",
    status: "failed", mediaStatus: "none", prompt: "让 Image 1 在雨夜街道上低机位跟拍", editorPrompt: "让 [[firefly-ref:reedit-reference]] 在雨夜街道上低机位跟拍", model: videoModels[0].id,
    mode: "omni", ratio: "9:16", resolution: "1080p", duration: 8, error: "上游暂时繁忙", createdAt, updatedAt: createdAt,
  }] });
  await page.goto("/studio/sessions/session-e2e");

  const editor = page.getByRole("textbox", { name: "创作提示词" });
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "重新编辑" }).click();

  await expect(editor).toContainText("在雨夜街道上低机位跟拍");
  await expect(editor.locator(".prompt-asset-token")).toHaveText("角色参考.png");
  await expect(editor).toBeFocused();
  await expect(page.locator(".composer-draft-status")).toContainText("已载入上次创作");
  await expect(page.locator(".asset-chip")).toContainText("角色参考.png");
  await expect(page).toHaveURL(/\/studio\/sessions\/session-e2e$/);
  await expect(page.locator(".control-row")).toContainText("全能参考");
  await expect(page.locator(".control-row")).toContainText("1080p");

  await editor.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await editor.press("Backspace");
  await expect(editor).toHaveText("");
  await editor.pressSequentially("改成清晨的手持跟拍");
  await expect(editor).toHaveText("改成清晨的手持跟拍");
  await expect(editor).toBeFocused();
});

test("video text-mode re-edit keeps a long prompt full width in the dock and on mobile", async ({ page }) => {
  const createdAt = Date.now() - 60_000;
  const longPrompt = "一段发生在普罗旺斯夏日午后的无字视觉故事。镜头从室内桌面的浅景深特写开始，跟随人物穿过门廊与花田，最终上升拉开，呈现整个金色山谷。";
  await mockAuthenticatedApi(page, { videoHistory: [{
    id: "video-text-reedit-width", sessionId: "session-e2e", caseId: "video-text-reedit-width", visibility: "private",
    status: "failed", mediaStatus: "none", prompt: longPrompt, model: videoModels[0].id,
    mode: "text", ratio: "16:9", resolution: "1080p", duration: 8, error: "上游暂时繁忙", createdAt, updatedAt: createdAt,
  }] });
  await page.goto("/studio/sessions/session-e2e");
  await page.getByRole("button", { name: "重新编辑" }).click();

  const editor = page.getByRole("textbox", { name: "创作提示词" });
  await expect(editor).toHaveText(longPrompt);
  const desktop = await page.locator(".prompt-row").evaluate((row) => ({ row: row.getBoundingClientRect().width, editor: row.querySelector<HTMLElement>(".prompt-editor")!.getBoundingClientRect().width }));
  expect(desktop.editor).toBeGreaterThan(desktop.row * 0.9);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator(".prompt-row").evaluate((row) => ({ row: row.getBoundingClientRect().width, editor: row.querySelector<HTMLElement>(".prompt-editor")!.getBoundingClientRect().width }));
  expect(mobile.editor).toBeGreaterThan(mobile.row * 0.9);
});

test("re-edit protects an unsent draft, supports undo, and reuses one fallback session without submitting", async ({ page }) => {
  const createdAt = Date.now() - 60_000;
  const mock = await mockAuthenticatedApi(page, { videoHistory: [{
    id: "video-reedit-conflict", sessionId: "session-e2e", caseId: "video-reedit-conflict", visibility: "private",
    status: "failed", mediaStatus: "none", prompt: "原始雨夜镜头", model: videoModels[0].id,
    mode: "omni", ratio: "16:9", resolution: "1080p", duration: 8, error: "上游暂时繁忙", createdAt, updatedAt: createdAt,
  }] });
  await page.goto("/studio/sessions/session-e2e");
  const editor = page.getByRole("textbox", { name: "创作提示词" });
  await expect(editor).toBeVisible();
  await editor.fill("用户尚未发送的草稿");
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "重新编辑" }).click();
  const conflict = page.getByRole("dialog", { name: "这里有尚未发送的内容" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "取消" }).click();
  await expect(editor).toContainText("用户尚未发送的草稿");

  await page.getByRole("button", { name: "重新编辑" }).click();
  await page.getByRole("dialog", { name: "这里有尚未发送的内容" }).getByRole("button", { name: "替换当前草稿" }).click();
  await expect(editor).toContainText("原始雨夜镜头");
  await page.getByRole("button", { name: "撤销替换" }).click();
  await expect(editor).toContainText("用户尚未发送的草稿");

  await page.getByRole("button", { name: "重新编辑" }).click();
  await page.getByRole("dialog", { name: "这里有尚未发送的内容" }).getByRole("button", { name: "在新会话打开" }).click();
  await expect(page).toHaveURL(/\/studio\/sessions\/reedit-video-video-reedit-conflict$/);
  await expect(editor).toContainText("原始雨夜镜头");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "创作提示词" })).toContainText("原始雨夜镜头");
  expect(mock.creationSessions().filter((session) => session.id === "reedit-video-video-reedit-conflict")).toHaveLength(1);
  expect(mock.fallbackSessionSources()).toEqual(["video:video-reedit-conflict"]);
  expect(mock.postedGenerations()).toHaveLength(0);
});

test("composer keeps uploaded assets available through the inline mention picker", async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto("/studio");

  await page.locator('.composer input[type="file"]').setInputFiles("public/ciridae/video-placeholder.webp");
  const attached = page.locator(".asset-chip").filter({ hasText: "video-placeholder.webp" });
  await expect(attached).toBeVisible({ timeout: 15_000 });
  await expect(attached).toContainText("已上传，可立即生成");
  await expect(page.getByRole("button", { name: "生成视频" })).toBeEnabled();

  const editor = page.getByRole("textbox", { name: "创作提示词" });
  await editor.click();
  await page.keyboard.type("@");
  const picker = page.getByRole("listbox", { name: "选择参考资产" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("option").filter({ hasText: "video-placeholder.webp" })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(editor.locator("[data-asset-id]")).toHaveCount(1);
  await expect(editor).toContainText("video-placeholder.webp");
});

test("asset archive preserves the selected media view across refresh", async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto("/studio/assets");

  await page.getByRole("button", { name: "图片资产" }).click();
  await expect(page).toHaveURL(/\/studio\/assets\?view=images$/);
  await expect(page.getByRole("heading", { name: "生成图片" })).toBeVisible();
  // Group metadata is a control-plane refresh. The deterministic Firefly
  // namespace must keep direct-to-TOS upload available when that request is
  // slow or temporarily unavailable (the mock intentionally returns 404).
  await expect(page.getByRole("button", { name: "上传图片" })).toBeEnabled();

  await page.reload();
  await expect(page.getByRole("button", { name: "图片资产" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "生成图片" })).toBeVisible();

  await page.getByRole("button", { name: "视频资产" }).click();
  await expect(page).toHaveURL(/\/studio\/assets$/);
});

test("studio restores an unsent composer draft and isolates it between creation sessions", async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto("/studio");
  const editor = page.locator(".prompt-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.fill("雨夜里缓慢推进的长镜头");
  await page.waitForTimeout(500);

  await page.reload();
  await expect(page.locator(".prompt-editor")).toHaveText("雨夜里缓慢推进的长镜头", { timeout: 30_000 });
  await expect(page.getByText("已恢复上次未发送的内容")).toBeVisible();

  await page.getByRole("button", { name: "新创作", exact: true }).click();
  await expect(page.locator(".prompt-editor")).toHaveText("");
  await page.locator(".prompt-editor").fill("第二个会话的独立草稿");
  await page.waitForTimeout(500);

  await page.locator(".session-item").nth(1).locator(".session-item__main").click();
  await expect(page.locator(".prompt-editor")).toHaveText("雨夜里缓慢推进的长镜头");
});

test("new creation reconciles a lost response without duplicating the session", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { creationSessionAdmissionResponseLost: true });
  await page.goto("/studio");
  await expect(page.getByRole("button", { name: "新创作", exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "新创作", exact: true }).click();

  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/studio\/sessions\/[0-9a-f-]{36}$/);
  expect(mock.postedSessionRequests()).toHaveLength(1);
  expect(mock.creationSessions()).toHaveLength(2);
  await expect(page.locator(".session-item")).toHaveCount(2);
});

test("empty Studio bootstrap recovers its first session after a lost response", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { creationSessions: [], creationSessionAdmissionResponseLost: true });
  await page.goto("/studio");

  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/studio\/sessions\/[0-9a-f-]{36}$/);
  expect(mock.postedSessionRequests()).toHaveLength(1);
  expect(mock.creationSessions()).toHaveLength(1);
  await expect(page.locator(".session-item")).toHaveCount(1);
  await expect(page.locator(".prompt-editor")).toBeVisible();
});

test("authenticated Canvas V2 opens, creates a node and preserves the app shell", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message === "ResizeObserver loop completed with undelivered notifications.") return;
    pageErrors.push(error.message);
  });
  const mock = await mockAuthenticatedApi(page);
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });
  await expect(page.getByText("让片段彼此照亮")).toBeVisible();
  await page.getByRole("button", { name: "资产库" }).click();
  await expect(page.getByLabel("画布资产").getByRole("button", { name: "角色", exact: true })).toBeVisible();
  await page.locator(".canvas-v2-assets>header button").click();
  await page.getByRole("button", { name: "帮助" }).hover();
  await page.getByRole("button", { name: "快捷键" }).click();
  const shortcutDialog = page.getByRole("dialog");
  await expect(page.getByRole("heading", { name: "画布快捷键" })).toBeVisible();
  await shortcutDialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  const shortcutBox = await shortcutDialog.boundingBox();
  expect(shortcutBox?.x).toBe(0); expect(shortcutBox?.width).toBe(page.viewportSize()?.width);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await expect.poll(() => pageErrors).toEqual([]);
  await expect(page.locator(".canvas-v2-node--text")).toHaveCount(1);
  await expect(page.getByTitle("H1 标题")).toBeVisible();
  await page.locator(".canvas-v2-account__avatar").click();
  await expect(page.getByText("artist@dokuai.tv")).toBeVisible();
  await expect(page.getByText(/已保存|本地草稿|保存中/)).toBeVisible();
  const releasesBeforePreferenceChange = mock.leaseReleaseCount();
  await page.getByTitle("小地图").click();
  await expect(page.getByText(/已保存|保存中/)).toBeVisible();
  await expect.poll(mock.leaseReleaseCount).toBe(releasesBeforePreferenceChange);
});

test("a held Canvas lease opens safely in read-only mode", async ({ page }) => {
  await mockAuthenticatedApi(page, { leaseHeld: true });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });
  await expect(page.getByText("只读模式", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "接管编辑" })).toBeVisible();
  await expect(page.getByText(/当前已安全打开为只读模式/)).toBeVisible();
});

test("an expired Canvas lease is reacquired after the network returns", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { expireLeaseOnce: true });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(mock.leaseRenewCount).toBeGreaterThanOrEqual(1);
  await expect.poll(mock.leasePostCount).toBe(2);
  await page.getByTitle("小地图").click();
  await expect.poll(() => mock.saveLeaseTokens().includes("f".repeat(64))).toBe(true);
  await expect(page.getByText("存在编辑冲突")).toHaveCount(0);
});

test("node menus stay anchored, text expands outside the flow transform, and references are truthful", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const mock = await mockAuthenticatedApi(page, { document: relationDocument });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });

  const target = page.locator(".canvas-v2-node--image");
  await expect(target.getByLabel("引用来源")).toContainText("雨夜对白");
  await target.hover();
  const plus = target.getByRole("button", { name: "引用该节点生成" });
  const plusBox = await plus.boundingBox();
  await plus.click();
  const menu = page.getByRole("menu", { name: "引用该节点生成" });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  // Geometry assertions must observe the settled overlay, not an intermediate
  // frame of the 180ms entrance animation on faster Linux Chromium runners.
  await menu.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const menuBox = await menu.boundingBox();
  expect(plusBox).not.toBeNull(); expect(menuBox).not.toBeNull();
  const placement = await menu.getAttribute("data-placement");
  const anchoredX = placement === "left" ? plusBox!.x - menuBox!.width - 10 : plusBox!.x + plusBox!.width + 10;
  expect(Math.abs(menuBox!.x - anchoredX)).toBeLessThanOrEqual(2);
  expect(plusBox!.y + plusBox!.height / 2).toBeGreaterThan(menuBox!.y);
  expect(plusBox!.y + plusBox!.height / 2).toBeLessThan(menuBox!.y + menuBox!.height);
  const arrowTop = Number.parseFloat(await menu.evaluate((element) => getComputedStyle(element).getPropertyValue("--canvas-menu-arrow-top")));
  expect(Math.abs(menuBox!.y + arrowTop - (plusBox!.y + plusBox!.height / 2))).toBeLessThanOrEqual(1);
  await page.locator(".react-flow__pane").hover();
  await page.mouse.wheel(0, -180);
  await expect(menu).toHaveCount(0);

  const zoom = page.getByLabel("画布缩放比例");
  const zoomBefore = await zoom.textContent();
  await page.getByRole("button", { name: "放大画布" }).click();
  await expect(zoom).not.toHaveText(zoomBefore ?? "");

  const source = page.locator(".canvas-v2-node--text");
  await source.getByTitle("放大编辑").click();
  const editorDialog = page.getByRole("dialog", { name: "放大编辑文本" });
  await expect(editorDialog).toBeVisible();
  await editorDialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  const editorBox = await editorDialog.boundingBox();
  expect(editorBox?.x).toBe(0); expect(editorBox?.width).toBe(page.viewportSize()?.width);
  await expect(editorDialog.getByLabel("文本节点内容")).toContainText("镜头从雨中的背影开始");
  await expect(page.locator(".react-flow__node .canvas-v2-richtext-shell--expanded")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editorDialog).toHaveCount(0);

  await page.getByTitle("隐藏连线").click();
  await expect.poll(() => mock.storedDocument().preferences.edgesHidden).toBe(true);
  await expect.poll(() => mock.storedDocument().connections).toEqual(relationDocument.connections);
  await page.getByTitle("隐藏连线").click();
  await expect(target.getByLabel("引用来源")).toContainText("雨夜对白");

  await target.click({ position: { x: 150, y: 180 } });
  await target.getByRole("button", { name: "生成", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "节点生成" });
  await composer.getByPlaceholder("描述希望生成的画面…").fill("保持构图，转为胶片质感");
  await composer.getByRole("button", { name: "开始生成" }).click();
  await expect.poll(() => mock.postedJobs().length).toBe(1);
  const generatedNodeId = mock.postedJobs()[0]!.nodeId;
  expect(generatedNodeId).not.toBe("target-image");
  await expect.poll(() => mock.storedDocument().nodes.some((node) => node.id === generatedNodeId)).toBe(true);
  await expect.poll(() => mock.storedDocument().connections.some((edge) => edge.source === "target-image" && edge.target === generatedNodeId)).toBe(true);

  await target.getByRole("button", { name: "移除引用 雨夜对白" }).click();
  await expect(target.getByLabel("引用来源")).toHaveCount(0);
  await expect.poll(() => mock.storedDocument().connections.some((edge) => edge.source === "source-text" && edge.target === "target-image")).toBe(false);
  await expect.poll(() => mock.storedDocument().connections.some((edge) => edge.source === "target-image" && edge.target === generatedNodeId)).toBe(true);
});

test("media nodes drag from their body, keep the selected stack, and persist uploaded or library assets", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const mock = await mockAuthenticatedApi(page, { document: emptyMediaDocument, projectAssets: [projectImageAsset] });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });

  for (const type of ["image", "video", "character", "scene"]) {
    const node = page.locator(`.canvas-v2-node--${type}`);
    await expect(node.getByRole("button", { name: "本地上传", exact: true })).toBeVisible();
    await expect(node.getByRole("button", { name: "资产库", exact: true })).toBeVisible();
  }

  let imageNode = page.locator('.canvas-v2-node[data-node-id="empty-image"]');
  // React Flow finishes its initial fit-view transition asynchronously; use a
  // settled coordinate so the cross-browser pointer gesture is deterministic.
  await page.waitForTimeout(500);
  const bodyBox = await imageNode.locator(".canvas-v2-node__body").boundingBox();
  expect(bodyBox).not.toBeNull();
  await page.mouse.move(bodyBox!.x + 24, bodyBox!.y + 28);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(bodyBox!.x + 136, bodyBox!.y + 92, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => mock.storedDocument().nodes.find((node) => node.id === "empty-image")?.position).not.toEqual({ x: 240, y: 100 });
  const persistedPosition = mock.storedDocument().nodes.find((node) => node.id === "empty-image")!.position;

  await page.reload();
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });
  await expect.poll(() => mock.storedDocument().nodes.find((node) => node.id === "empty-image")?.position).toEqual(persistedPosition);
  imageNode = page.locator('.canvas-v2-node[data-node-id="empty-image"]');
  await imageNode.locator(".canvas-v2-node__head").click();
  const nodeBox = await imageNode.boundingBox();
  const toolsBox = await imageNode.locator(".canvas-v2-node__tools").boundingBox();
  expect(nodeBox).not.toBeNull(); expect(toolsBox).not.toBeNull();
  expect(toolsBox!.y + toolsBox!.height).toBeLessThanOrEqual(nodeBox!.y + 2);
  await imageNode.getByRole("button", { name: "生成", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "节点生成" });
  await expect(composer).toBeVisible();
  await page.waitForTimeout(420);
  const movedNodeBox = await imageNode.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(movedNodeBox).not.toBeNull(); expect(composerBox).not.toBeNull();
  expect(composerBox!.y).toBeGreaterThanOrEqual(movedNodeBox!.y + movedNodeBox!.height + 8);
  await page.keyboard.press("Escape");

  // Use a real, policy-compliant image. WebKit intermittently rejects the old
  // synthetic 1px PNG before the product's normalization path can run.
  await imageNode.locator('input[type="file"]').setInputFiles("public/ciridae/video-placeholder.webp");
  await expect(page.getByText(/素材已放入节点|素材已保存/)).toBeVisible();
  await expect(imageNode.getByRole("img", { name: "node-upload.png" })).toBeVisible();
  await expect.poll(() => mock.storedDocument().nodes.find((node) => node.id === "empty-image")?.data.projectAssetId, { timeout: 15_000 }).toMatch(/^project-upload-e2e-/);

  const characterNode = page.locator('.canvas-v2-node[data-node-id="empty-character"]');
  await characterNode.getByRole("button", { name: "资产库", exact: true }).click();
  const assetPanel = page.getByRole("dialog", { name: "画布资产" });
  await expect(assetPanel.getByText("为「空角色」选择素材")).toBeVisible();
  await assetPanel.locator(".canvas-v2-assets__list>button").filter({ hasText: "常用角色参考" }).click();
  await expect.poll(() => mock.storedDocument().nodes.find((node) => node.id === "empty-character")?.data.projectAssetId).toBe("project-library-image");
  await expect(characterNode.getByRole("img", { name: "常用角色参考" })).toBeVisible();
});

test("an interrupted local Canvas upload recovers instead of spinning forever", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { document: interruptedUploadDocument });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });

  const node = page.locator('.canvas-v2-node[data-node-id="interrupted-image"]');
  await expect(node.getByRole("button", { name: "本地上传", exact: true })).toBeVisible();
  await expect(node.getByRole("button", { name: "资产库", exact: true })).toBeVisible();
  await expect(node.locator('header i[title="上次本地素材保存未完成，请重新选择素材"]')).toBeVisible();
  await expect(node.locator(".spin")).toHaveCount(0);
  await expect.poll(() => mock.storedDocument().nodes[0]?.data.status).toBe("failed");
});

test("image generation confirms immediately and moves provider waiting into the result card", async ({ page }) => {
  await mockAuthenticatedApi(page, { imageGenerationDelayMs: 1_500 });
  await page.goto("/studio");
  await page.getByRole("button", { name: "视频生成", exact: true }).click();
  await page.getByRole("button", { name: "图片生成 支持文生图与图生图" }).click();
  await page.locator(".control").filter({ hasText: "1:1" }).click();
  await page.locator(".image-format-pop").getByRole("button", { name: "16:9", exact: true }).click();
  await page.keyboard.press("Escape");
  const prompt = "一盏放在雨夜窗边的暖色台灯";
  await page.getByRole("textbox", { name: "创作提示词" }).fill(prompt);
  const send = page.locator(".send-button");
  await send.click();
  await expect(page.locator(".composer-dock")).toBeVisible({ timeout: 500 });
  await expect(page.locator(".image-result--generating")).toBeVisible();
  const pendingBox = await page.locator(".image-result--generating").boundingBox();
  const dockBox = await page.locator(".composer-dock").boundingBox();
  expect(pendingBox).not.toBeNull(); expect(dockBox).not.toBeNull(); expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(dockBox!.y + 2);
  await expect(page.getByRole("img", { name: prompt })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".image-result--generating")).toHaveCount(0);
  const resultBox = await page.locator(".image-result__grid figure").boundingBox();
  expect(resultBox).not.toBeNull(); expect(resultBox!.width / resultBox!.height).toBeGreaterThan(1.7);
  await page.reload();
  await expect(page.getByRole("img", { name: prompt })).toBeVisible();
});

test("new creation sessions isolate the stage and can be renamed or removed without deleting assets", async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto("/studio");
  const newCreation = page.getByRole("button", { name: "新创作", exact: true });
  await expect(newCreation).toBeVisible();
  await newCreation.click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/studio\/sessions\/[0-9a-f-]{36}$/);
  const active = page.locator(".session-item.is-active");
  await active.hover();
  await active.getByRole("button", { name: /重命名/ }).click();
  const title = active.getByRole("textbox", { name: "会话名称" });
  await title.fill("雨夜分镜"); await title.press("Enter");
  await expect(active.getByText("雨夜分镜", { exact: true })).toBeVisible();
  await active.hover(); await active.getByRole("button", { name: /删除/ }).click();
  await expect(page.getByRole("heading", { name: "删除“雨夜分镜”？" })).toBeVisible();
  await page.getByRole("button", { name: "删除会话" }).click();
  await expect(page.getByText("雨夜分镜", { exact: true })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/studio/sessions/session-e2e");
});

test("session switching uses the isolated cached snapshot when one history feed is unavailable", async ({ page }) => {
  const now = Date.now();
  await mockAuthenticatedApi(page, {
    creationSessions: [
      { id: "session-a", title: "会话 A", createdAt: now, updatedAt: now },
      { id: "session-b", title: "会话 B", createdAt: now - 1, updatedAt: now - 1 },
    ],
    imageHistory: [
      { id: "image-a", sessionId: "session-a", modelName: "Image", ratio: "1:1", resolution: "1024", prompt: "只属于会话 A", items: [], createdAt: now, status: "failed", error: "fixture" },
      { id: "image-b", sessionId: "session-b", modelName: "Image", ratio: "1:1", resolution: "1024", prompt: "只属于会话 B", items: [], createdAt: now - 1, status: "failed", error: "fixture" },
    ],
    imageSessionFailures: ["session-b"],
  });
  await page.goto("/studio/sessions/session-a");
  await expect(page.getByText("「只属于会话 A」")).toBeVisible();

  await page.locator(".session-item").filter({ hasText: "会话 B" }).locator(".session-item__main").click();
  await expect(page.getByText("「只属于会话 B」")).toBeVisible();
  await expect(page.getByText("「只属于会话 A」")).toHaveCount(0);
  await expect(page.getByText("同步暂时中断")).toBeVisible();
});

test("a lost video admission response reconciles by client id without creating a duplicate", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { generationAdmissionResponseLost: true });
  await page.goto("/studio/sessions/session-e2e");
  await page.getByRole("button", { name: "全能参考", exact: true }).click();
  await page.getByRole("button", { name: /文本生成/ }).click();
  const prompt = "雨夜车站缓慢推进的长镜头";
  await page.getByRole("textbox", { name: "创作提示词" }).fill(prompt);
  await page.locator(".send-button").click();

  await expect(page.locator(".task-card").filter({ hasText: prompt })).toBeVisible();
  await expect(page.locator(".task-card")).toHaveCount(1);
  await expect(page.locator(".composer-dock").getByRole("textbox", { name: "创作提示词" })).toHaveText("");
  await expect.poll(() => mock.postedGenerations()).toHaveLength(1);
  expect(mock.postedGenerations()[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("video generation acknowledges the click while task admission completes in the background", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { holdGenerationAdmission: true });
  await page.goto("/studio/sessions/session-e2e");
  await page.getByRole("button", { name: "全能参考", exact: true }).click();
  await page.getByRole("button", { name: /文本生成/ }).click();
  const prompt = "海边公路上缓慢后退的长镜头";
  await page.getByRole("textbox", { name: "创作提示词" }).fill(prompt);
  await page.locator(".send-button").click();

  const confirmation = page.locator(".composer-generation-status");
  await expect(confirmation).toContainText("已提交，正在确认任务", { timeout: 500 });
  await expect(confirmation).toContainText("接纳后会立即进入上方生成队列");
  await expect(page.getByRole("button", { name: "视频已提交，正在确认任务" })).toBeVisible();
  await expect(page.locator(".task-card").filter({ hasText: prompt })).toHaveCount(0);
  mock.releaseGenerationAdmission();
  await expect(page.locator(".task-card").filter({ hasText: prompt })).toBeVisible({ timeout: 8_000 });
  await expect(confirmation).toHaveCount(0);
});

test("a fast text edit is committed to the browser draft before the page leaves", async ({ page }) => {
  await mockAuthenticatedApi(page, { document: relationDocument });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly", { timeout: 30_000 });

  const editor = page.locator(".canvas-v2-node--text").getByLabel("文本节点内容");
  await editor.fill("这一笔必须先留在本地");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("firefly-canvas-v2", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").get("canvas-e2e");
      request.onsuccess = () => resolve(request.result?.document?.nodes?.find((node: { id: string }) => node.id === "source-text")?.data?.markdown ?? "");
      request.onerror = () => reject(request.error);
    });
  })).toBe("这一笔必须先留在本地");
});
