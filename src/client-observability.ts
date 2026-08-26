export type ClientJourney = "studio_bootstrap" | "asset_archive_view" | "poster_load" | "frontend_runtime";
export type ClientJourneyOutcome = "success" | "failure";

type ClientJourneyEvent = {
  journey: ClientJourney;
  outcome: ClientJourneyOutcome;
  elapsedMs?: number;
  taskId?: string;
  component?: string;
  errorCode?: string;
  fingerprint?: string;
};

const sentRuntimeErrors = new Map<string, number>();
const routeStartedAt = new Map<string, number>([[location.pathname, performance.now()]]);
const cleanText = (value: unknown, limit = 120) => String(value ?? "unknown")
  .replace(/https?:\/\/[^\s)]+/g, "[url]")
  .replace(/[\r\n\t]+/g, " ")
  .slice(0, limit);
const fingerprint = (kind: string, message: unknown, component?: string) => {
  const input = `${kind}:${cleanText(message, 80)}:${component ?? "window"}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${kind}:${(hash >>> 0).toString(16)}`;
};

export function reportClientJourney(event: ClientJourneyEvent) {
  const payload = { ...event, route: location.pathname.slice(0, 160) };
  void fetch("/api/client-events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

export const markClientRouteStart = (path: string) => routeStartedAt.set(path, performance.now());
export const clientRouteElapsed = (path: string) => Math.max(0, Math.round(performance.now() - (routeStartedAt.get(path) ?? performance.now())));

export function reportFrontendError(error: unknown, component?: string) {
  const message = error instanceof Error ? error.message : error;
  const key = fingerprint("runtime", message, component);
  const now = Date.now();
  if ((sentRuntimeErrors.get(key) ?? 0) > now - 60_000) return;
  sentRuntimeErrors.set(key, now);
  reportClientJourney({ journey: "frontend_runtime", outcome: "failure", component, errorCode: cleanText(error instanceof Error ? error.name : "CLIENT_ERROR", 48), fingerprint: key.slice(0, 160) });
}

export function installClientErrorCapture() {
  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) {
      const element = event.target as HTMLElement;
      reportFrontendError(`resource:${element.tagName.toLowerCase()}`, "resource");
      return;
    }
    reportFrontendError(event.error ?? event.message, "window");
  }, true);
  window.addEventListener("unhandledrejection", (event) => reportFrontendError(event.reason, "promise"));
}
