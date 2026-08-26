export type TosArchiveErrorCode =
  | "TOS_FETCH_PENDING"
  | "TOS_SOURCE_EXPIRED"
  | "TOS_PERMISSION_DENIED"
  | "TOS_UPLOAD_MISSING"
  | "TOS_REQUEST_TIMEOUT"
  | "TOS_RATE_LIMITED"
  | "TOS_UNAVAILABLE"
  | "TOS_NETWORK_ERROR"
  | "TOS_UNKNOWN_ERROR";

export type TosArchiveStage =
  | "source_probe"
  | "source_read"
  | "tos_head"
  | "tos_fetch_create"
  | "tos_fetch_poll"
  | "tos_list_parts"
  | "tos_create_multipart"
  | "tos_upload_part"
  | "tos_complete_multipart"
  | "tos_verify";

export type TosArchiveFailure = Error & {
  archiveStage?: TosArchiveStage;
  code?: string;
  statusCode?: number;
  status?: number;
  requestId?: string;
};

export const withTosArchiveStage = (error: unknown, archiveStage: TosArchiveStage): TosArchiveFailure => {
  const failure = error instanceof Error ? error as TosArchiveFailure : new Error(String(error)) as TosArchiveFailure;
  try { failure.archiveStage = archiveStage; }
  catch {
    const wrapped = new Error(failure.message, { cause: failure }) as TosArchiveFailure;
    wrapped.archiveStage = archiveStage;
    wrapped.code = failure.code;
    wrapped.statusCode = failure.statusCode;
    wrapped.status = failure.status;
    wrapped.requestId = failure.requestId;
    return wrapped;
  }
  return failure;
};

const sourceStage = (stage: TosArchiveStage | undefined) => stage === "source_probe" || stage === "source_read";
const tosStage = (stage: TosArchiveStage | undefined) => Boolean(stage?.startsWith("tos_"));

export const tosArchiveErrorCode = (error: unknown): TosArchiveErrorCode => {
  const failure = error as TosArchiveFailure | undefined;
  const code = String(failure?.code ?? "");
  const status = Number(failure?.statusCode ?? failure?.status ?? 0);
  const stage = failure?.archiveStage;
  const message = error instanceof Error ? error.message : "";
  if (code === "TOS_FETCH_PENDING") return "TOS_FETCH_PENDING";
  if (/NoSuchUpload/i.test(`${code} ${message}`) || (stage === "tos_list_parts" && status === 404)) return "TOS_UPLOAD_MISSING";
  if (tosStage(stage) && [401, 403].includes(status)) return "TOS_PERMISSION_DENIED";
  if ((sourceStage(stage) && [401, 403, 404, 410].includes(status)) || /source.*(?:expired|not found)|上游.*(?:过期|不存在)/i.test(message)) return "TOS_SOURCE_EXPIRED";
  if ((error as Error | undefined)?.name === "AbortError" || /timeout|超时|超过 \d+ 秒/i.test(message)) return "TOS_REQUEST_TIMEOUT";
  if (status === 429 || /rate.?limit|slowdown/i.test(`${code} ${message}`)) return "TOS_RATE_LIMITED";
  if (status >= 500) return "TOS_UNAVAILABLE";
  if (/network|socket|ECONN|ENOTFOUND|fetch failed/i.test(`${code} ${message}`)) return "TOS_NETWORK_ERROR";
  return "TOS_UNKNOWN_ERROR";
};
