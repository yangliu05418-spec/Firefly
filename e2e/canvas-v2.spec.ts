import { expect, test, type Page, type Route } from "@playwright/test";

const documentV2 = { version: 2, viewport: { x: 0, y: 0, k: 1 }, background: "dots", preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false }, nodes: [], connections: [] };
const videoModels = [{ id: "dreamina-seedance-2-5-260628", name: "Seedance 2.5", note: "旗舰模型", modes: ["omni", "text"], resolutions: ["720p", "1080p"], ratios: ["adaptive", "16:9", "9:16"], duration: [4, 30], imageLimit: 30, videoLimit: 10, audioLimit: 10, audioOnly: true, supportsAudio: true, outputFormats: ["mp4"] }];
const imageModels = [{ id: "google/gemini-3.1-flash-lite-image", name: "Nano Banana 2 Lite", resolutions: ["512", "1024"], defaultResolution: "1024", maxCount: 4 }];

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockAuthenticatedApi(page: Page) {
  let revision = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/auth/session") return json(route, { authenticated: true, user: { id: "user-e2e", email: "artist@dokuai.tv", name: "Artist", avatarUrl: "" } });
    if (path === "/api/models") return json(route, videoModels);
    if (path === "/api/image-models") return json(route, { Items: imageModels, Ratios: ["16:9", "1:1", "9:16"], DefaultModel: imageModels[0].id });
    if (path === "/api/generations") return json(route, []);
    if (path === "/api/canvas/config") return json(route, { enabled: true });
    if (path === "/api/canvases/canvas-e2e/lease" && request.method() === "POST") return json(route, { acquired: true, token: "e".repeat(64), ttlMs: 30_000 });
    if (path === "/api/canvases/canvas-e2e/lease") return route.fulfill({ status: 204 });
    if (path === "/api/canvases/canvas-e2e/assets") return json(route, { Items: [], HasMore: false });
    if (path === "/api/canvases/canvas-e2e/jobs") return json(route, { Items: [] });
    if (path === "/api/canvases/canvas-e2e/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\n" });
    if (path === "/api/canvases/canvas-e2e" && request.method() === "GET") return json(route, { id: "canvas-e2e", title: "分镜实验", revision, updatedAt: Date.now(), document: documentV2 });
    if (path === "/api/canvases/canvas-e2e" && request.method() === "PUT") {
      const payload = request.postDataJSON() as { document: unknown };
      revision += 1;
      return json(route, { id: "canvas-e2e", title: "分镜实验", revision, updatedAt: Date.now(), document: payload.document });
    }
    if (path === "/api/canvases/canvas-e2e" && request.method() === "PATCH") return json(route, { id: "canvas-e2e", title: "分镜实验" });
    return json(route, { error: `Unhandled E2E route: ${request.method()} ${path}` }, 404);
  });
}

test("landing keeps the restrained Firefly entrance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /开始创作/ })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("authenticated Canvas V2 opens, creates a node and preserves the app shell", async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto("/studio/canvas/canvas-e2e");
  await expect(page.getByTitle("回到全部项目")).toContainText("Firefly");
  await expect(page.getByText("让片段彼此照亮")).toBeVisible();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await expect(page.locator(".canvas-v2-node--text")).toHaveCount(1);
  await expect(page.getByText(/已保存|本地草稿|保存中/)).toBeVisible();
});
