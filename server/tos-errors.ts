export type TosArchiveErrorCode = "TOS_FETCH_PENDING" | "TOS_SOURCE_EXPIRED" | "TOS_REQUEST_TIMEOUT" | "TOS_RATE_LIMITED" | "TOS_UNAVAILABLE" | "TOS_NETWORK_ERROR" | "TOS_UNKNOWN_ERROR";

export const tosArchiveErrorCode = (error: unknown): TosArchiveErrorCode => {
  const code = String((error as { code?: unknown })?.code ?? "");
  const status = Number((error as { statusCode?: unknown })?.statusCode ?? (error as { status?: unknown })?.status ?? 0);
  const message = error instanceof Error ? error.message : "";
  if (code === "TOS_FETCH_PENDING") return "TOS_FETCH_PENDING";
  if ([401, 403, 404, 410].includes(status) || /source.*(?:expired|not found)|上游.*(?:过期|不存在)/i.test(message)) return "TOS_SOURCE_EXPIRED";
  if ((error as Error | undefined)?.name === "AbortError" || /timeout|超时|超过 \d+ 秒/i.test(message)) return "TOS_REQUEST_TIMEOUT";
  if (status === 429 || /rate.?limit|slowdown/i.test(`${code} ${message}`)) return "TOS_RATE_LIMITED";
  if (status >= 500) return "TOS_UNAVAILABLE";
  if (/network|socket|ECONN|ENOTFOUND|fetch failed/i.test(`${code} ${message}`)) return "TOS_NETWORK_ERROR";
  return "TOS_UNKNOWN_ERROR";
};
