import crypto from "node:crypto";
import { z } from "zod";

export const ATLAS_AGENT_CATALOG_VERSION = "1";
export const ATLAS_AGENT_MAX_TOOL_CALLS = 32;

export type AtlasAgentRisk = "low" | "medium" | "destructive" | "external";

type JsonSchema = Readonly<Record<string, unknown>>;

export class AtlasAgentProtocolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AtlasAgentProtocolError";
    this.status = status;
    this.code = code;
  }
}

const forbiddenJsonKeys = new Set(["__proto__", "prototype", "constructor"]);

/** Reject values that JSON cannot faithfully and safely represent. */
export const assertSafeJson = (value: unknown, limits: { maxDepth?: number; maxNodes?: number; maxStringLength?: number } = {}) => {
  const maxDepth = limits.maxDepth ?? 16;
  const maxNodes = limits.maxNodes ?? 10_000;
  const maxStringLength = limits.maxStringLength ?? 100_000;
  let nodes = 0;
  const visit = (current: unknown, depth: number, path: string): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new AtlasAgentProtocolError(400, "AGENT_JSON_TOO_LARGE", "Agent 数据结构过大");
    if (depth > maxDepth) throw new AtlasAgentProtocolError(400, "AGENT_JSON_TOO_DEEP", "Agent 数据嵌套过深");
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new AtlasAgentProtocolError(400, "AGENT_JSON_NON_FINITE", `${path} 包含非有限数值`);
      return;
    }
    if (typeof current === "string") {
      if (current.length > maxStringLength) throw new AtlasAgentProtocolError(400, "AGENT_JSON_STRING_TOO_LONG", `${path} 文本过长`);
      return;
    }
    if (typeof current !== "object") throw new AtlasAgentProtocolError(400, "AGENT_JSON_UNSUPPORTED", `${path} 包含不支持的数据类型`);
    if (Object.getOwnPropertySymbols(current).length) throw new AtlasAgentProtocolError(400, "AGENT_JSON_SYMBOL", `${path} 包含 Symbol 属性`);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) visit(current[index], depth + 1, `${path}[${index}]`);
      return;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw new AtlasAgentProtocolError(400, "AGENT_JSON_PROTOTYPE", `${path} 不是普通 JSON 对象`);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if (forbiddenJsonKeys.has(key)) throw new AtlasAgentProtocolError(400, "AGENT_JSON_FORBIDDEN_KEY", `${path} 包含不安全字段`);
      if (descriptor.get || descriptor.set || !("value" in descriptor)) throw new AtlasAgentProtocolError(400, "AGENT_JSON_ACCESSOR", `${path} 包含访问器属性`);
      if (!descriptor.enumerable) throw new AtlasAgentProtocolError(400, "AGENT_JSON_HIDDEN_PROPERTY", `${path} 包含不可序列化属性`);
      visit(descriptor.value, depth + 1, `${path}.${key}`);
    }
  };
  visit(value, 0, "$ ".trim());
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
  );
  return value;
};

export const canonicalJson = (value: unknown) => {
  assertSafeJson(value);
  return JSON.stringify(canonicalize(value));
};

export const digestJson = (value: unknown) => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");

const id = z.string().trim().min(1).max(128).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "标识符包含控制字符");
const finite = z.number().finite();
const milliseconds = finite.min(0).max(86_400_000);
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const hasAtLeastOneDefinedValue = (value: Record<string, unknown>) => Object.values(value).some((item) => item !== undefined);

const toolSchemas = {
  split_clip: strict({ clipId: id, atMs: milliseconds }),
  trim_clip: strict({ clipId: id, sourceInMs: milliseconds, sourceOutMs: milliseconds })
    .refine((value) => value.sourceOutMs > value.sourceInMs, "结束时间必须晚于开始时间"),
  move_clip: strict({ clipId: id, trackId: id, startMs: milliseconds }),
  reorder_clips: strict({ trackId: id, clipIds: z.array(id).min(1).max(500) })
    .refine((value) => new Set(value.clipIds).size === value.clipIds.length, "片段顺序不能包含重复项"),
  delete_clip: strict({ clipId: id }),
  insert_project_asset: strict({ assetId: id, trackId: id, startMs: milliseconds }),
  create_track: strict({ trackId: id, kind: z.enum(["video", "audio"]), index: z.number().int().min(0).max(127).optional() }),
  set_track_muted: strict({ trackId: id, muted: z.boolean() }),
  set_clip_volume: strict({ clipId: id, volume: finite.min(0).max(4) }),
  set_transform: strict({
    clipId: id,
    positionX: finite.min(-100_000).max(100_000).optional(),
    positionY: finite.min(-100_000).max(100_000).optional(),
    scaleX: finite.min(0.01).max(100).optional(),
    scaleY: finite.min(0.01).max(100).optional(),
    rotationDeg: finite.min(-36_000).max(36_000).optional(),
    opacity: finite.min(0).max(1).optional(),
  }).refine((value) => hasAtLeastOneDefinedValue({ ...value, clipId: undefined }), "至少需要一个变换参数"),
  add_transition: strict({
    transitionId: id,
    fromClipId: id,
    toClipId: id,
    type: z.enum(["crossfade", "wipe_left", "wipe_right", "wipe_up", "wipe_down", "dip_to_black"]),
    durationMs: finite.min(50).max(10_000),
  }).refine((value) => value.fromClipId !== value.toClipId, "转场两侧不能是同一个片段"),
  remove_transition: strict({ transitionId: id }),
  request_export: strict({ preset: z.literal("mp4_h264_aac_1080p30"), fileName: z.string().trim().min(1).max(180).optional() }),
} as const;

export type AtlasAgentToolName = keyof typeof toolSchemas;

type ToolDefinition = {
  description: string;
  risk: AtlasAgentRisk;
  requiresConfirmation: boolean;
  schema: JsonSchema;
};

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object", additionalProperties: false, properties, required,
});
const idSchema = { type: "string", minLength: 1, maxLength: 128 };
const msSchema = { type: "number", minimum: 0, maximum: 86_400_000 };

export const ATLAS_AGENT_TOOL_CATALOG: Readonly<Record<AtlasAgentToolName, ToolDefinition>> = Object.freeze({
  split_clip: { description: "在片段内部时间点切割片段", risk: "low", requiresConfirmation: false, schema: objectSchema({ clipId: idSchema, atMs: msSchema }, ["clipId", "atMs"]) },
  trim_clip: { description: "修改片段源素材入点和出点", risk: "low", requiresConfirmation: false, schema: objectSchema({ clipId: idSchema, sourceInMs: msSchema, sourceOutMs: msSchema }, ["clipId", "sourceInMs", "sourceOutMs"]) },
  move_clip: { description: "将片段移动到轨道和时间点", risk: "low", requiresConfirmation: false, schema: objectSchema({ clipId: idSchema, trackId: idSchema, startMs: msSchema }, ["clipId", "trackId", "startMs"]) },
  reorder_clips: { description: "设置轨道内片段的确定顺序", risk: "low", requiresConfirmation: false, schema: objectSchema({ trackId: idSchema, clipIds: { type: "array", minItems: 1, maxItems: 500, uniqueItems: true, items: idSchema } }, ["trackId", "clipIds"]) },
  delete_clip: { description: "从时间线删除一个片段", risk: "destructive", requiresConfirmation: true, schema: objectSchema({ clipId: idSchema }, ["clipId"]) },
  insert_project_asset: { description: "把已授权项目资产插入时间线", risk: "medium", requiresConfirmation: false, schema: objectSchema({ assetId: idSchema, trackId: idSchema, startMs: msSchema }, ["assetId", "trackId", "startMs"]) },
  create_track: { description: "创建视频或音频轨道", risk: "low", requiresConfirmation: false, schema: objectSchema({ trackId: idSchema, kind: { type: "string", enum: ["video", "audio"] }, index: { type: "integer", minimum: 0, maximum: 127 } }, ["trackId", "kind"]) },
  set_track_muted: { description: "设置轨道静音状态", risk: "low", requiresConfirmation: false, schema: objectSchema({ trackId: idSchema, muted: { type: "boolean" } }, ["trackId", "muted"]) },
  set_clip_volume: { description: "设置片段音量增益", risk: "low", requiresConfirmation: false, schema: objectSchema({ clipId: idSchema, volume: { type: "number", minimum: 0, maximum: 4 } }, ["clipId", "volume"]) },
  set_transform: { description: "设置片段画面变换参数", risk: "low", requiresConfirmation: false, schema: objectSchema({ clipId: idSchema, positionX: { type: "number", minimum: -100_000, maximum: 100_000 }, positionY: { type: "number", minimum: -100_000, maximum: 100_000 }, scaleX: { type: "number", minimum: 0.01, maximum: 100 }, scaleY: { type: "number", minimum: 0.01, maximum: 100 }, rotationDeg: { type: "number", minimum: -36_000, maximum: 36_000 }, opacity: { type: "number", minimum: 0, maximum: 1 } }, ["clipId"]) },
  add_transition: { description: "在两个片段间添加基础转场", risk: "low", requiresConfirmation: false, schema: objectSchema({ transitionId: idSchema, fromClipId: idSchema, toClipId: idSchema, type: { type: "string", enum: ["crossfade", "wipe_left", "wipe_right", "wipe_up", "wipe_down", "dip_to_black"] }, durationMs: { type: "number", minimum: 50, maximum: 10_000 } }, ["transitionId", "fromClipId", "toClipId", "type", "durationMs"]) },
  remove_transition: { description: "移除一个转场", risk: "low", requiresConfirmation: false, schema: objectSchema({ transitionId: idSchema }, ["transitionId"]) },
  request_export: { description: "请求导出当前时间线", risk: "external", requiresConfirmation: true, schema: objectSchema({ preset: { type: "string", const: "mp4_h264_aac_1080p30" }, fileName: { type: "string", minLength: 1, maxLength: 180 } }, ["preset"]) },
});

export const ATLAS_AGENT_CATALOG_DIGEST = digestJson({ version: ATLAS_AGENT_CATALOG_VERSION, tools: ATLAS_AGENT_TOOL_CATALOG });

const rawOperationSchema = strict({
  sequence: z.number().int().min(1).max(ATLAS_AGENT_MAX_TOOL_CALLS),
  tool: z.enum(Object.keys(toolSchemas) as [AtlasAgentToolName, ...AtlasAgentToolName[]]),
  args: z.unknown(),
});

const rawPlanSchema = strict({
  version: z.literal(1),
  summary: z.string().trim().min(1).max(500),
  operations: z.array(rawOperationSchema).min(1).max(ATLAS_AGENT_MAX_TOOL_CALLS),
});

export type AtlasAgentOperation = {
  sequence: number;
  tool: AtlasAgentToolName;
  args: Record<string, unknown>;
  risk: AtlasAgentRisk;
  requiresConfirmation: boolean;
  operationKey: string;
  operationDigest: string;
};

export type AtlasAgentPlan = {
  version: 1;
  summary: string;
  catalogVersion: string;
  catalogDigest: string;
  baseRevision: number;
  operations: AtlasAgentOperation[];
  planDigest: string;
};

export const normalizeAtlasAgentPlan = (raw: unknown, input: { runId: string; baseRevision: number; maxToolCalls?: number }): AtlasAgentPlan => {
  assertSafeJson(raw);
  const parsed = rawPlanSchema.safeParse(raw);
  if (!parsed.success) throw new AtlasAgentProtocolError(422, "AGENT_PLAN_INVALID", "Agent 返回了无效的操作计划");
  const maxToolCalls = Math.min(ATLAS_AGENT_MAX_TOOL_CALLS, input.maxToolCalls ?? ATLAS_AGENT_MAX_TOOL_CALLS);
  if (parsed.data.operations.length > maxToolCalls) throw new AtlasAgentProtocolError(422, "AGENT_PLAN_TOO_LARGE", "Agent 操作步骤超过上限");
  const exportIndexes = parsed.data.operations.flatMap((operation, index) => operation.tool === "request_export" ? [index] : []);
  if (exportIndexes.length > 1) throw new AtlasAgentProtocolError(422, "AGENT_PLAN_EXPORT_DUPLICATE", "Agent 计划最多只能请求一次导出");
  if (exportIndexes.length === 1 && exportIndexes[0] !== parsed.data.operations.length - 1) {
    throw new AtlasAgentProtocolError(422, "AGENT_PLAN_EXPORT_ORDER_INVALID", "导出必须是 Agent 计划的最后一步");
  }
  const operations = parsed.data.operations.map((operation, index): AtlasAgentOperation => {
    if (operation.sequence !== index + 1) throw new AtlasAgentProtocolError(422, "AGENT_PLAN_SEQUENCE_INVALID", "Agent 操作序号必须连续且从 1 开始");
    const schema = toolSchemas[operation.tool];
    const result = schema.safeParse(operation.args);
    if (!result.success) throw new AtlasAgentProtocolError(422, "AGENT_TOOL_ARGS_INVALID", `Agent 工具 ${operation.tool} 参数无效`);
    const definition = ATLAS_AGENT_TOOL_CATALOG[operation.tool];
    const operationCore = { runId: input.runId, sequence: operation.sequence, tool: operation.tool, args: result.data, baseRevision: input.baseRevision, catalogDigest: ATLAS_AGENT_CATALOG_DIGEST };
    return {
      sequence: operation.sequence,
      tool: operation.tool,
      args: result.data as Record<string, unknown>,
      risk: definition.risk,
      requiresConfirmation: definition.requiresConfirmation,
      operationKey: `${input.runId}:${operation.sequence}`,
      operationDigest: digestJson(operationCore),
    };
  });
  const core = {
    version: 1 as const,
    summary: parsed.data.summary,
    catalogVersion: ATLAS_AGENT_CATALOG_VERSION,
    catalogDigest: ATLAS_AGENT_CATALOG_DIGEST,
    baseRevision: input.baseRevision,
    operations,
  };
  return { ...core, planDigest: digestJson(core) };
};

const transformSchema = strict({
  positionX: finite.optional(), positionY: finite.optional(), scaleX: finite.optional(), scaleY: finite.optional(),
  rotationDeg: finite.optional(), opacity: finite.optional(),
});
const clipSchema = strict({
  id, trackId: id, assetId: id.optional(), kind: z.enum(["video", "audio", "image", "text"]),
  startMs: milliseconds, durationMs: milliseconds, sourceInMs: milliseconds.optional(), sourceOutMs: milliseconds.optional(),
  volume: finite.min(0).max(4).optional(), muted: z.boolean().optional(), transform: transformSchema.optional(),
});
const trackSchema = strict({
  id, kind: z.enum(["video", "audio"]), muted: z.boolean(), locked: z.boolean(), clipIds: z.array(id).max(500),
});
const assetSchema = strict({
  id, kind: z.enum(["video", "audio", "image"]), name: z.string().trim().min(1).max(300),
  durationMs: milliseconds.optional(), width: z.number().int().min(1).max(32_768).optional(), height: z.number().int().min(1).max(32_768).optional(),
});

export const atlasAgentSemanticSnapshotSchema = strict({
  version: z.literal(1),
  revision: z.number().int().min(0),
  durationMs: milliseconds,
  tracks: z.array(trackSchema).max(128),
  clips: z.array(clipSchema).max(2_000),
  assets: z.array(assetSchema).max(500),
  selection: strict({ clipIds: z.array(id).max(500), trackIds: z.array(id).max(128) }),
}).superRefine((snapshot, context) => {
  const trackIds = new Set(snapshot.tracks.map((track) => track.id));
  const clipIds = new Set(snapshot.clips.map((clip) => clip.id));
  const assetIds = new Set(snapshot.assets.map((asset) => asset.id));
  if (trackIds.size !== snapshot.tracks.length || clipIds.size !== snapshot.clips.length || assetIds.size !== snapshot.assets.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "语义快照包含重复标识符" });
  for (const clip of snapshot.clips) {
    if (!trackIds.has(clip.trackId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "片段引用了不存在的轨道" });
    if (clip.assetId && !assetIds.has(clip.assetId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "片段引用了不存在的资产" });
  }
});

export type AtlasAgentSemanticSnapshot = z.infer<typeof atlasAgentSemanticSnapshotSchema>;

export const parseAtlasAgentSemanticSnapshot = (value: unknown): AtlasAgentSemanticSnapshot => {
  assertSafeJson(value, { maxNodes: 50_000, maxStringLength: 2_000 });
  const parsed = atlasAgentSemanticSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new AtlasAgentProtocolError(400, "AGENT_SNAPSHOT_INVALID", "时间线语义快照无效或超出边界");
  return parsed.data;
};

const toolOperationSchemas = Object.entries(ATLAS_AGENT_TOOL_CATALOG).map(([name, definition]) => ({
  type: "object", additionalProperties: false,
  properties: { sequence: { type: "integer", minimum: 1, maximum: ATLAS_AGENT_MAX_TOOL_CALLS }, tool: { type: "string", const: name }, args: definition.schema },
  required: ["sequence", "tool", "args"],
}));

export const ATLAS_AGENT_PLAN_JSON_SCHEMA: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    version: { type: "integer", const: 1 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    operations: { type: "array", minItems: 1, maxItems: ATLAS_AGENT_MAX_TOOL_CALLS, items: { oneOf: toolOperationSchemas } },
  },
  required: ["version", "summary", "operations"],
};

export const atlasAgentResultReceiptDigest = (input: {
  runId: string; sequence: number; planDigest: string; status: "succeeded" | "failed"; result: unknown;
  beforeRevision: number; afterRevision: number; historyNodeId?: string;
}) => digestJson({
  runId: input.runId,
  sequence: input.sequence,
  planDigest: input.planDigest,
  status: input.status,
  result: input.result,
  beforeRevision: input.beforeRevision,
  afterRevision: input.afterRevision,
  ...(input.historyNodeId === undefined ? {} : { historyNodeId: input.historyNodeId }),
});
