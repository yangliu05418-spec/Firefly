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
const projectImageAsset: CanvasProjectAsset = {
  id: "project-library-image", canvasId: "canvas-e2e", kind: "image", title: "常用角色参考", contentType: "image/png", size: 128,
  width: 512, height: 512, status: "ready", createdAt: 1, updatedAt: 1,
  mediaUrl: "/api/canvas-project-assets/project-library-image/media", downloadUrl: "/api/canvas-project-assets/project-library-image/media?download=1",
};
const videoModels = [{ id: "dreamina-seedance-2-5-260628", name: "Seedance 2.5", note: "旗舰模型", modes: ["omni", "text"], resolutions: ["720p", "1080p"], ratios: ["adaptive", "16:9", "9:16"], duration: [4, 30], imageLimit: 30, videoLimit: 10, audioLimit: 10, audioOnly: true, supportsAudio: true, outputFormats: ["mp4"] }];
const imageModels = [{ id: "google/gemini-3.1-flash-lite-image", name: "Nano Banana 2 Lite", resolutions: ["1024"], defaultResolution: "1024", maxCount: 4 }];

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockAuthenticatedApi(page: Page, options: { leaseHeld?: boolean; expireLeaseOnce?: boolean; document?: CanvasDocumentV2; imageGenerationDelayMs?: number; projectAssets?: CanvasProjectAsset[] } = {}) {
  let revision = 0;
  let storedDocument = structuredClone(options.document ?? documentV2);
  let leaseReleaseCount = 0;
  let imageHistory: unknown[] = [];
  let creationSessions = [{ id: "session-e2e", title: "新创作", createdAt: Date.now(), updatedAt: Date.now() }];
  let leasePostCount = 0;
  let leaseRenewCount = 0;
  const saveLeaseTokens: string[] = [];
  const postedJobs: Array<{ kind: string; nodeId: string; revision: number }> = [];
  let projectAssets = structuredClone(options.projectAssets ?? []);
  let uploadCount = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/auth/session") return json(route, { authenticated: true, user: { id: "user-e2e", email: "artist@dokuai.tv", name: "Artist", avatarUrl: "" } });
    if (path === "/api/models") return json(route, videoModels);
    if (path === "/api/image-models") return json(route, { Items: imageModels, Ratios: ["16:9", "1:1", "9:16"], DefaultModel: imageModels[0].id });
    if (path === "/api/creation-sessions" && request.method() === "GET") return json(route, creationSessions);
    if (path === "/api/creation-sessions" && request.method() === "POST") {
      const session = { id: `session-e2e-${creationSessions.length + 1}`, title: "新创作", createdAt: Date.now(), updatedAt: Date.now() };
      creationSessions = [session, ...creationSessions]; return json(route, session, 201);
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
    if (path === "/api/image-generations" && request.method() === "GET") return json(route, imageHistory);
    if (path === "/api/image-generation" && request.method() === "POST") {
      const body = request.postDataJSON() as { requestId: string; sessionId: string; prompt: string; ratio: string; resolution: string; count: number };
      const pending = { id: body.requestId, sessionId: body.sessionId, modelName: imageModels[0].name, ratio: body.ratio, resolution: body.resolution, prompt: body.prompt, requestedCount: body.count, status: "generating", items: [], failed: [], createdAt: Date.now() };
      imageHistory = [pending];
      setTimeout(() => { imageHistory = [{ ...pending, status: "succeeded", items: [{ mediaId: "image-e2e" }] }]; }, options.imageGenerationDelayMs ?? 0);
      return json(route, { Id: body.requestId, Items: [], Model: imageModels[0].id, Ratio: body.ratio, Resolution: body.resolution, Failed: [], Status: "generating" }, 202);
    }
    if (path === "/api/image-media/image-e2e") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path fill="#b8d9cf" d="M0 0h8v8H0z"/></svg>' });
    if (path === "/api/generations") return json(route, []);
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
      return json(route, { id: uploadId, uploadId, name: "node-upload.png", type: "image", size: 68 });
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
    storedDocument: () => structuredClone(storedDocument),
  };
}

test("landing keeps the restrained Firefly entrance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /开始创作/ })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
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
  await page.waitForTimeout(220);
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
  await page.waitForTimeout(220);
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

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await imageNode.locator('input[type="file"]').setInputFiles({ name: "node-upload.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText(/素材已放入节点|素材已保存/)).toBeVisible();
  await expect(imageNode.getByRole("img", { name: "node-upload.png" })).toBeVisible();
  await expect.poll(() => mock.storedDocument().nodes.find((node) => node.id === "empty-image")?.data.projectAssetId).toMatch(/^project-upload-e2e-/);

  const characterNode = page.locator('.canvas-v2-node[data-node-id="empty-character"]');
  await characterNode.getByRole("button", { name: "资产库", exact: true }).click();
  const assetPanel = page.getByRole("dialog", { name: "画布资产" });
  await expect(assetPanel.getByText("为「空角色」选择素材")).toBeVisible();
  await assetPanel.locator(".canvas-v2-assets__list>button").filter({ hasText: "常用角色参考" }).click();
  await expect.poll(() => mock.storedDocument().nodes.find((node) => node.id === "empty-character")?.data.projectAssetId).toBe("project-library-image");
  await expect(characterNode.getByRole("img", { name: "常用角色参考" })).toBeVisible();
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
  await expect(page.getByText("新创作", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新创作", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toContain("/studio/sessions/session-e2e-2");
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
