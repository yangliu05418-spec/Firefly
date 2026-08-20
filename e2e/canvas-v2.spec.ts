import { expect, test, type Page, type Route } from "@playwright/test";

const documentV2 = { version: 2, viewport: { x: 0, y: 0, k: 1 }, background: "dots", preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false }, nodes: [], connections: [] };
const videoModels = [{ id: "dreamina-seedance-2-5-260628", name: "Seedance 2.5", note: "旗舰模型", modes: ["omni", "text"], resolutions: ["720p", "1080p"], ratios: ["adaptive", "16:9", "9:16"], duration: [4, 30], imageLimit: 30, videoLimit: 10, audioLimit: 10, audioOnly: true, supportsAudio: true, outputFormats: ["mp4"] }];
const imageModels = [{ id: "google/gemini-3.1-flash-lite-image", name: "Nano Banana 2 Lite", resolutions: ["512", "1024"], defaultResolution: "1024", maxCount: 4 }];

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockAuthenticatedApi(page: Page, options: { leaseHeld?: boolean; expireLeaseOnce?: boolean } = {}) {
  let revision = 0;
  let leaseReleaseCount = 0;
  let leasePostCount = 0;
  let leaseRenewCount = 0;
  const saveLeaseTokens: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/auth/session") return json(route, { authenticated: true, user: { id: "user-e2e", email: "artist@dokuai.tv", name: "Artist", avatarUrl: "" } });
    if (path === "/api/models") return json(route, videoModels);
    if (path === "/api/image-models") return json(route, { Items: imageModels, Ratios: ["16:9", "1:1", "9:16"], DefaultModel: imageModels[0].id });
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
    if (path === "/api/canvases/canvas-e2e/assets") return json(route, { Items: [], HasMore: false });
    if (path === "/api/canvases/canvas-e2e/jobs") return json(route, { Items: [] });
    if (path === "/api/canvases/canvas-e2e/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\n" });
    if (path === "/api/canvases/canvas-e2e" && request.method() === "GET") return json(route, { id: "canvas-e2e", title: "分镜实验", revision, updatedAt: Date.now(), document: documentV2 });
    if (path === "/api/canvases/canvas-e2e" && request.method() === "PUT") {
      const payload = request.postDataJSON() as { document: unknown };
      saveLeaseTokens.push(request.headers()["x-canvas-lease"] ?? "");
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
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly");
  await expect(page.getByText("让片段彼此照亮")).toBeVisible();
  await page.getByRole("button", { name: "资产库" }).click();
  await expect(page.getByLabel("画布资产").getByRole("button", { name: "角色", exact: true })).toBeVisible();
  await page.locator(".canvas-v2-assets>header button").click();
  await page.getByRole("button", { name: "帮助" }).hover();
  await page.getByRole("button", { name: "快捷键" }).click();
  await expect(page.getByRole("heading", { name: "画布快捷键" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly");
  await expect(page.getByText("只读模式", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "接管编辑" })).toBeVisible();
  await expect(page.getByText(/当前已安全打开为只读模式/)).toBeVisible();
});

test("an expired Canvas lease is reacquired after the network returns", async ({ page }) => {
  const mock = await mockAuthenticatedApi(page, { expireLeaseOnce: true });
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByRole("button", { name: "Firefly 画布导航" })).toContainText("Firefly");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(mock.leaseRenewCount).toBeGreaterThanOrEqual(1);
  await expect.poll(mock.leasePostCount).toBe(2);
  await page.getByTitle("小地图").click();
  await expect.poll(() => mock.saveLeaseTokens().includes("f".repeat(64))).toBe(true);
  await expect(page.getByText("存在编辑冲突")).toHaveCount(0);
});
