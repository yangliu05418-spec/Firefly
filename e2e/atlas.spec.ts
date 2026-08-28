import { expect, test, type Page, type Route } from "@playwright/test";

const atlasOrigin = "http://127.0.0.1:4174";
const projectId = "atlas-project-e2e";
const now = new Date("2026-08-28T08:00:00.000Z").toISOString();

type Project = {
  id: string;
  title: string;
  revision: number;
  hasCheckpoint: boolean;
  createdAt: string;
  updatedAt: string;
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const originalTimeline = (page: Page) => page.locator(
  '.dock-panel-content[data-panel-type="timeline"] .timeline-container',
);

const originalPreview = (page: Page) => page.locator(
  '.dock-panel-content[data-panel-type="preview"] .preview-container[aria-label="Preview"]',
);

async function expectOriginalEditorLayout(page: Page) {
  const dock = page.locator('.dock-container');
  const timeline = originalTimeline(page);
  await expect(dock).toBeVisible();
  await expect(timeline).toBeVisible();
  await expect(originalPreview(page)).toBeVisible();

  const [dockBox, timelineBox, bodyBox, trackStackBox] = await Promise.all([
    dock.boundingBox(),
    timeline.boundingBox(),
    timeline.locator('.timeline-body').boundingBox(),
    timeline.locator('.timeline-track-stack').boundingBox(),
  ]);
  expect(dockBox).not.toBeNull();
  expect(timelineBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(trackStackBox).not.toBeNull();
  expect(timelineBox!.width / dockBox!.width).toBeGreaterThan(0.98);
  expect(Math.abs(timelineBox!.x - dockBox!.x)).toBeLessThanOrEqual(4);
  expect(Math.abs((timelineBox!.x + timelineBox!.width) - (dockBox!.x + dockBox!.width))).toBeLessThanOrEqual(4);
  expect(bodyBox!.width / timelineBox!.width).toBeGreaterThan(0.98);
  expect(trackStackBox!.width / timelineBox!.width).toBeGreaterThan(0.98);
}

async function mockAtlasApi(page: Page) {
  const projects: Project[] = [];
  const bootstrapCookies: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;

    if (pathname === "/api/atlas/bootstrap" && method === "GET") {
      bootstrapCookies.push(request.headers().cookie ?? "");
      return json(route, {
        user: { id: "atlas-user-e2e", name: "剪辑测试员", email: "editor@dokuai.tv" },
        capabilities: { agent: true, maxUploadBytes: 8 * 1024 ** 3, partSize: 16 * 1024 ** 2, uploadConcurrency: 3 },
      });
    }
    if (pathname === "/api/atlas/projects" && method === "GET") return json(route, { items: projects });
    if (pathname === "/api/atlas/projects" && method === "POST") {
      const input = request.postDataJSON() as { title: string };
      const project = { id: projectId, title: input.title, revision: 0, hasCheckpoint: false, createdAt: now, updatedAt: now };
      projects.unshift(project);
      return json(route, project, 201);
    }
    if (pathname === `/api/atlas/projects/${projectId}` && method === "GET") return json(route, projects[0]);
    if (pathname === `/api/atlas/projects/${projectId}/lease` && method === "POST") {
      return json(route, { token: "l".repeat(64), deviceId: "device-e2e", expiresAt: Date.now() + 45_000 });
    }
    if (pathname === `/api/atlas/projects/${projectId}/lease` && method === "PUT") {
      return json(route, { deviceId: "device-e2e", expiresAt: Date.now() + 45_000 });
    }
    if (pathname === `/api/atlas/projects/${projectId}/lease` && method === "DELETE") return route.fulfill({ status: 204 });
    if (pathname === `/api/atlas/projects/${projectId}/checkpoints` && method === "POST") {
      const input = request.postDataJSON() as { expectedRevision: number };
      if (projects[0]) {
        projects[0].revision = input.expectedRevision + 1;
        projects[0].hasCheckpoint = true;
        projects[0].updatedAt = new Date().toISOString();
      }
      return json(route, { status: "ready", revision: input.expectedRevision + 1 });
    }
    if (pathname === `/api/atlas/projects/${projectId}/assets` && method === "GET") return json(route, { items: [] });
    if (pathname === "/api/assets" || pathname === "/api/generations") return json(route, { items: [] });
    return json(route, { code: "E2E_ROUTE_UNHANDLED", error: `${method} ${pathname}` }, 501);
  });

  return { bootstrapCookies, projects };
}

test.describe("Atlas production SPA", () => {
  test.use({ baseURL: atlasOrigin });
  test.skip(({ browserName }) => browserName !== "chromium", "Atlas v1 supports desktop Chrome and Edge only");

  test("serves the real sub-path build with isolated headers and immutable hash chunks", async ({ page, request }) => {
    const api = await mockAtlasApi(page);
    await page.context().addCookies([{ name: "firefly_session", value: "existing-session", url: atlasOrigin }]);

    const documentResponse = await page.goto("/studio/atlas/");
    expect(documentResponse?.status()).toBe(200);
    expect(documentResponse?.headers()["cache-control"]).toBe("no-cache");
    expect(documentResponse?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(documentResponse?.headers()["cross-origin-embedder-policy"]).toBe("credentialless");
    expect(documentResponse?.headers()["origin-agent-cluster"]).toBe("?1");
    expect(documentResponse?.headers()["content-security-policy"]).toContain("worker-src 'self' blob:");
    expect(documentResponse?.headers()["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    await expect(page.getByRole("heading", { name: "你的剪辑项目" })).toBeVisible();
    await expect(page.getByText("从第一段素材开始")).toBeVisible();
    expect(api.bootstrapCookies).toEqual([expect.stringContaining("firefly_session=existing-session")]);

    const resourceUrls = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    const hashedChunkUrl = resourceUrls.find((url) => /\/studio\/atlas\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css)$/.test(url));
    expect(hashedChunkUrl).toBeTruthy();
    const chunkResponse = await request.get(hashedChunkUrl!);
    expect(chunkResponse.status()).toBe(200);
    expect(chunkResponse.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(chunkResponse.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(chunkResponse.headers()["cross-origin-embedder-policy"]).toBe("credentialless");

    await page.reload();
    await expect(page.getByRole("heading", { name: "你的剪辑项目" })).toBeVisible();
    expect(api.bootstrapCookies).toHaveLength(2);
  });

  test("creates a Chinese project, enters the workspace, survives refresh, and links back to Firefly", async ({ page }) => {
    await mockAtlasApi(page);
    await page.context().addCookies([{ name: "firefly_session", value: "existing-session", url: atlasOrigin }]);
    await page.goto("/studio/atlas/");

    const backToFirefly = page.getByRole("link", { name: "返回 Firefly" });
    await expect(backToFirefly).toHaveAttribute("href", "/studio");
    await page.getByRole("button", { name: "新建项目" }).first().click();
    const dialog = page.getByRole("dialog", { name: "新建项目" });
    await dialog.getByLabel("重命名项目").fill("首支中文剪辑");
    await dialog.getByRole("button", { name: "新建项目" }).click();

    await expect(page).toHaveURL(new RegExp(`/studio/atlas/\\?project=${projectId}$`));
    await expect(page.getByRole("button", { name: "返回 Atlas 项目" })).toBeVisible();
    await expect(page.locator(".project-name")).toContainText("首支中文剪辑");
    await expectOriginalEditorLayout(page);

    await page.reload();
    await expect(page.locator(".project-name")).toContainText("首支中文剪辑");
    await page.getByRole("button", { name: "返回 Atlas 项目" }).click();
    await expect(page.getByRole("heading", { name: "你的剪辑项目" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "首支中文剪辑" })).toBeVisible();
  });

  test("keeps the editor usable at the effective 150 percent desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await mockAtlasApi(page);
    await page.context().addCookies([{ name: "firefly_session", value: "existing-session", url: atlasOrigin }]);
    await page.goto("/studio/atlas/");
    await page.getByRole("button", { name: "新建项目" }).first().click();
    const dialog = page.getByRole("dialog", { name: "新建项目" });
    await dialog.getByLabel("重命名项目").fill("缩放回归");
    await dialog.getByRole("button", { name: "新建项目" }).click();

    await expectOriginalEditorLayout(page);
    const layout = await page.evaluate(() => {
      const selectors = [
        '.dock-container',
        '.dock-panel-content[data-panel-type="timeline"] .timeline-container',
        '.dock-panel-content[data-panel-type="preview"] .preview-container[aria-label="Preview"]',
      ];
      const boxes = selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      return {
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        boxes,
      };
    });
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.scrollHeight).toBe(layout.clientHeight);
    for (const box of layout.boxes) {
      expect(box).not.toBeNull();
      expect(box!.left).toBeGreaterThanOrEqual(0);
      expect(box!.right).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(box!.top).toBeGreaterThanOrEqual(0);
      expect(box!.bottom).toBeLessThanOrEqual(layout.clientHeight + 1);
    }

    const rootResizeHandle = page.locator("[data-guided-target='dock-resize:root-split']");
    await expect(rootResizeHandle).toBeVisible();
    await expect(rootResizeHandle).toHaveAttribute('data-guided-resize-axis', 'y');
    const timelineBefore = await originalTimeline(page).boundingBox();
    const handleBox = await rootResizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y - 45, { steps: 5 });
    await page.mouse.up();
    const timelineAfter = await originalTimeline(page).boundingBox();
    expect(Math.abs((timelineAfter?.height ?? 0) - (timelineBefore?.height ?? 0))).toBeGreaterThan(20);

    const previewTab = page.locator('[data-guided-panel-tab="preview"]');
    const leftPane = page.locator('.dock-tab-pane[data-group-id="left-group"]');
    const [previewTabBox, leftPaneBox] = await Promise.all([
      previewTab.boundingBox(),
      leftPane.boundingBox(),
    ]);
    expect(previewTabBox).not.toBeNull();
    expect(leftPaneBox).not.toBeNull();
    await page.mouse.move(
      previewTabBox!.x + previewTabBox!.width / 2,
      previewTabBox!.y + previewTabBox!.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(550);
    await expect(page.locator('.dock-container')).toHaveClass(/dragging/);
    await page.mouse.move(
      leftPaneBox!.x + leftPaneBox!.width / 2,
      leftPaneBox!.y + Math.min(80, leftPaneBox!.height / 2),
      { steps: 10 },
    );
    await expect(leftPane).toHaveClass(/drop-target/);
    await page.mouse.up();
    const movedPreviewTabBox = await page.locator('[data-guided-panel-tab="preview"]').boundingBox();
    expect(movedPreviewTabBox).not.toBeNull();
    expect(movedPreviewTabBox!.x).toBeLessThan(previewTabBox!.x - 40);

    await page.reload();
    await expect.poll(async () => Math.abs(
      ((await page.locator('[data-guided-panel-tab="preview"]').boundingBox())?.x ?? -10_000)
        - movedPreviewTabBox!.x,
    )).toBeLessThanOrEqual(3);
    await expect.poll(async () => Math.abs(
      ((await originalTimeline(page).boundingBox())?.height ?? 0) - timelineAfter!.height,
    )).toBeLessThanOrEqual(3);
  });
});
