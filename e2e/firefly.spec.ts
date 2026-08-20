import { expect, test, type Page, type Route } from "@playwright/test";

const user = { id: "user-e2e", email: "artist@dokuai.tv", name: "Firefly Artist", avatarUrl: "" };
const model = { id: "dreamina-seedance-2-0-pro-260428", name: "Seedance 2.0 Pro", note: "E2E model", modes: ["omni", "text"], resolutions: ["720p"], ratios: ["16:9", "1:1"], duration: [4, 12], imageLimit: 9, videoLimit: 3, audioLimit: 3, audioOnly: false, supportsAudio: true, outputFormats: ["mp4"] };
const imageModel = { id: "google/gemini-3.1-flash-image", name: "Nano Banana 2", resolutions: ["1024"], defaultResolution: "1024", maxCount: 4 };

const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function mockStudio(page: Page, options: { imageSequence?: ("running" | "succeeded")[]; videoTasks?: unknown[] } = {}) {
  let imageRead = 0;
  let uploadNumber = 0;
  const uploadNames = new Map<string, string>();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/session") return json(route, { authenticated: true, user });
    if (url.pathname === "/api/models") return json(route, [model]);
    if (url.pathname === "/api/generations") return json(route, options.videoTasks ?? []);
    if (url.pathname === "/api/image-models") return json(route, { Items: [imageModel], Ratios: ["1:1"], DefaultModel: imageModel.id });
    if (url.pathname === "/api/image-generations") {
      const states = options.imageSequence ?? [];
      const status = states[Math.min(imageRead++, Math.max(0, states.length - 1))];
      if (!status) return json(route, { Items: [] });
      return json(route, { Items: [{ id: "image-task-e2e", status, model: imageModel.id, modelName: imageModel.name, ratio: "1:1", resolution: "1024", count: 1, prompt: "A glass firefly", Items: status === "succeeded" ? [{ mediaId: "generated-e2e" }] : [], Failed: [], createdAt: Date.now(), updatedAt: Date.now() }] });
    }
    if (url.pathname === "/api/uploads" && request.method() === "POST") { const id = `upload-${++uploadNumber}`; const body = request.postDataJSON() as { name: string }; uploadNames.set(id, body.name); return json(route, { id, chunkSize: 1024 * 1024, direct: false }); }
    if (/^\/api\/uploads\/upload-\d+\/chunks$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/^\/api\/uploads\/upload-\d+\/complete$/.test(url.pathname)) { const id = url.pathname.split("/")[3]; return json(route, { id, uploadId: id, name: uploadNames.get(id) ?? "reference.png", type: "image", size: 8 }); }
    if (url.pathname === "/api/canvases" && request.method() === "GET") return json(route, { Items: [], PageNumber: 1, PageSize: 50, HasMore: false });
    if (url.pathname === "/api/canvases" && request.method() === "POST") return json(route, { id: "canvas-e2e", title: "未命名画布" }, 201);
    if (url.pathname === "/api/canvases/canvas-e2e" && request.method() === "PATCH") return json(route, { id: "canvas-e2e", title: "镜头板" });
    if (url.pathname === "/api/image-media/generated-e2e") return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
    return json(route, { error: `Unhandled E2E API: ${request.method()} ${url.pathname}` }, 404);
  });
}

test("landing and enterprise login follow the public UX contract", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /My fancies are fireflies/ })).toBeVisible();
  await page.getByRole("button", { name: "开始创作" }).click();
  await expect(page.getByRole("heading", { name: "进入创作台" })).toBeVisible();
  const loginRequest = page.waitForRequest((request) => request.url().includes("/api/auth/feishu/start?returnTo=%2Fstudio"));
  await page.getByRole("button", { name: /使用飞书企业账号登录/ }).click();
  await loginRequest;
});

test("restores a signed-in session and renders private project history", async ({ page }) => {
  await mockStudio(page, { videoTasks: [{ id: "task-e2e", caseId: "case-e2e", ownerId: user.id, visibility: "private", status: "running", mediaStatus: "none", prompt: "Rain crossing a cinema screen", model: model.id, mode: "text", ratio: "16:9", resolution: "720p", duration: 4, createdAt: Date.now(), updatedAt: Date.now() }] });
  await page.goto("/studio");
  await page.getByRole("button", { name: "打开账号菜单" }).click();
  await expect(page.getByText("Firefly Artist")).toBeVisible();
  await expect(page.getByText("Rain crossing a cinema screen").first()).toBeVisible();
  await expect(page.getByText("1 项进行中")).toBeVisible();
});

test("accepts multiple reference files in one picker interaction", async ({ page }) => {
  await mockStudio(page);
  await page.goto("/studio");
  const input = page.locator('input[type="file"][multiple]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: "second.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
  ]);
  await expect(page.locator(".asset-chip")).toHaveCount(2);
  await expect(page.getByText("first.png")).toBeVisible();
  await expect(page.getByText("second.png")).toBeVisible();
});

test("keeps generation mode and model controls predictable", async ({ page }) => {
  await mockStudio(page);
  await page.goto("/studio");
  await page.getByRole("button", { name: /视频生成/ }).first().click();
  await expect(page.getByRole("tab", { name: "视频生成" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "图片生成" }).click();
  await page.getByRole("button", { name: /图片生成/ }).first().click();
  await expect(page.getByText(/OpenRouter 图像模型|Nano Banana/).first()).toBeVisible();
});

test("restores an active image task and replaces waiting state with its durable result", async ({ page }) => {
  await mockStudio(page, { imageSequence: ["running", "running", "succeeded"] });
  await page.goto("/studio");
  await expect(page.getByText("正在生成")).toBeVisible();
  await expect(page.locator('img[src="/api/image-media/generated-e2e"]')).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("系统在线")).toBeVisible();
});

test("creates a canvas from the dedicated workspace without leaving the page", async ({ page }) => {
  await mockStudio(page);
  await page.goto("/studio");
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(page.getByRole("heading", { name: "画布", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建画布" }).first().click();
  const title = page.getByRole("textbox", { name: "画布名称" });
  await expect(title).toBeVisible();
  await title.fill("镜头板");
  await title.press("Enter");
  await expect(page.getByText("镜头板")).toBeVisible();
});
