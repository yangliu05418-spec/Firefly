import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  addEdge, Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, useViewport,
  type Connection, type Edge, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { Archive, Check, ChevronDown, CircleHelp, Copy, Download, FolderOpen, Grid2X2, Group as GroupIcon, Home, ImageIcon, Keyboard, LayoutDashboard, Library, LoaderCircle, LockKeyhole, LogOut, Map as MapIcon, MousePointer2, Move, Plus, Redo2, RefreshCw, ScanFace, Scissors, Search, Sparkles, TextCursorInput, Undo2, Ungroup, Upload, Users, Video, WandSparkles, X, ZoomIn, ZoomOut } from "lucide-react";
import { api, inferUploadType } from "../../../api";
import { RecoveringThumbnail } from "../../../recovering-image";
import { uploadFileUntilAccepted } from "../../../upload-acceptance";
import { filterCachedAssets, loadAssetsCacheFirst } from "../../../asset-metadata-cache";
import { runWithConcurrency } from "../../../concurrency";
import { readPendingAssetPreview, removePendingAssetPreview, storePendingAssetPreview } from "../../../pending-asset-preview-cache";
import { useAdaptiveRefresh } from "../../../use-adaptive-refresh";
import { useImageModelCatalog } from "../../../use-image-model-catalog";
import type { AssetCategory, ImageModel, LibraryAsset, ModelCapability, SessionUser } from "../../../types";
import {
  acquireCanvasLease, cancelCanvasJob, createCanvasJob, getCanvasV2, importCanvasProjectAsset, listCanvasAssets, listCanvasJobs,
  releaseCanvasLease, renewCanvasLease, saveCanvasV2, type CanvasJob, type CanvasProjectAsset,
} from "../canvas-api";
import { canCreateFromNode, createCanvasNodeV2, defaultCanvasDocumentV2, NODE_CONNECTION_MATRIX, toCanvasDocumentV2, type CanvasDocumentV2, type CanvasNodeTypeV2, type CanvasNodeV2 } from "../canvas-v2-types";
import { deleteCanvasDraft, readCanvasDraft, writeCanvasDraft } from "./canvas-draft";
import { CanvasV2Node, type CanvasFlowData, type CanvasFlowNode } from "./CanvasV2Node";
import { canvasAssetDownloadName } from "./canvas-download";
import { canvasVideoModeForReferences, canvasVideoModelsForReferences, type CanvasVideoReferenceKind } from "./canvas-video-capability";
import { CANVAS_INITIAL_FIT_VIEW_OPTIONS, hasCanvasConnection, incomingCanvasReferences, placeCanvasMenu, withoutEphemeralCanvasElements, type CanvasMenuAnchor } from "./canvas-ux";

const CanvasMontage = lazy(() => import("./CanvasMontage").then((module) => ({ default: module.CanvasMontage })));
const EMPTY_IMAGE_MODELS: ImageModel[] = [];
const EMPTY_IMAGE_RATIOS: string[] = [];

type SaveState = "saved" | "draft" | "saving" | "offline" | "conflict" | "error";
type CreateMenu = { sourceId?: string; side?: "left" | "right"; anchor?: CanvasMenuAnchor; screen?: { x: number; y: number }; position?: { x: number; y: number }; focusOnOpen?: boolean };
type CreateMenuStyle = CSSProperties & { placement?: "left" | "right"; "--canvas-menu-arrow-top"?: string };
type ComposerState = { nodeId: string; prompt: string; kind: "text" | "image" | "video" | "character_tool"; model: string; ratio: string; resolution: string; duration: number; tool: "turnaround" | "closeup" | "expressions" | "portrait"; portraitStyle: string; strength: "轻" | "标准" | "强"; textAction: "replace_selection" | "append" | "overwrite"; selectionText: string };
type CanvasUploadItem = { id: string; name: string; progress: number; phase: "preparing" | "uploading" | "verifying" | "saving"; error?: string };
const nodeTypes = { character: CanvasV2Node, scene: CanvasV2Node, text: CanvasV2Node, image: CanvasV2Node, video: CanvasV2Node, group: CanvasV2Node, "legacy-audio": CanvasV2Node };
const creatableTypes = ["character", "scene", "video", "image", "text"] as const;
const typeLabels: Record<CanvasNodeTypeV2, string> = { character: "角色", scene: "场景", video: "视频", image: "图片", text: "文本", group: "分组", "legacy-audio": "旧音频" };
const typeIcons: Record<string, typeof ImageIcon> = { character: ScanFace, scene: LayoutDashboard, video: Video, image: ImageIcon, text: TextCursorInput, group: Users };
const assetCategoryLabels: Record<AssetCategory, string> = { character: "角色", scene: "场景", prop: "道具", material: "素材" };
const acceptsProjectAsset = (nodeType: CanvasNodeTypeV2, assetKind: CanvasProjectAsset["kind"]) =>
  nodeType === "video" ? assetKind === "video" : ["image", "character", "scene"].includes(nodeType) ? assetKind === "image" : false;
const canvasPreviewCacheId = (canvasId: string, assetId: string) => `canvas:${canvasId}:${assetId}`;
const shortcutGroups = [
  ["创作", [["成组", "Ctrl / Cmd + G"], ["解组", "Ctrl / Cmd + Shift + G"], ["生成", "Ctrl / Cmd + Enter"], ["新建节点", "Tab"], ["复制节点", "Alt / Option + 拖动"], ["复制选区", "Ctrl / Cmd + Alt / Option + 拖动"]]],
  ["视图", [["放大 / 缩小", "Ctrl / Cmd + + / −"], ["适应画布", "Ctrl / Cmd + 0"], ["移动画布", "Space + 拖动"], ["整理画布", "Alt / Option + Shift + F"]]],
  ["通用", [["搜索", "Ctrl / Cmd + F"], ["撤销 / 重做", "Ctrl / Cmd + Z / Y"], ["全选", "Ctrl / Cmd + A"], ["删除", "Delete"]]],
] as const;

const clientId = () => {
  const key = "firefly-canvas-client-id";
  const current = sessionStorage.getItem(key);
  if (current) return current;
  const created = `canvas-client-${crypto.randomUUID()}`;
  sessionStorage.setItem(key, created);
  return created;
};

const edgeStyle = { stroke: "rgba(186, 204, 201, .48)", strokeWidth: 1.35 };
const toEdge = (edge: CanvasDocumentV2["connections"][number]): Edge => ({ ...edge, type: "bezier", markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "rgba(186, 204, 201, .5)" }, style: edgeStyle });
const canvasReferenceKinds = (targetId: string, nodes: readonly CanvasFlowNode[], edges: readonly Edge[]) => {
  const target = nodes.find((node) => node.id === targetId);
  const kindFor = (node?: CanvasFlowNode): CanvasVideoReferenceKind | undefined => {
    if (!node?.data.domain.data.projectAssetId) return undefined;
    return node.data.domain.type === "video" ? "video" : node.data.domain.type === "legacy-audio" ? "audio" : "image";
  };
  const ownKind = kindFor(target);
  if (ownKind) return [ownKind];
  const byAsset = new Map<string, CanvasVideoReferenceKind>();
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const source = nodes.find((node) => node.id === edge.source);
    const assetId = source?.data.domain.data.projectAssetId;
    const kind = kindFor(source);
    if (assetId && kind) byAsset.set(assetId, kind);
  }
  return [...byAsset.values()];
};

function CanvasZoomControls() {
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const { zoom } = useViewport();
  return <>
    <button type="button" onClick={() => flow.zoomOut({ duration: 180 })} title="缩小画布" aria-label="缩小画布"><ZoomOut /></button>
    <output aria-label="画布缩放比例">{Math.round(zoom * 100)}%</output>
    <button type="button" onClick={() => flow.zoomIn({ duration: 180 })} title="放大画布" aria-label="放大画布"><ZoomIn /></button>
  </>;
}

function Workspace({ canvasId, navigate, user, logout }: { canvasId: string; navigate: (path: string) => void; user: SessionUser; logout: () => void }) {
  const { catalog: imageModelCatalog, error: imageModelCatalogError } = useImageModelCatalog();
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const viewport = useViewport();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [projectTitle, setProjectTitle] = useState("未命名画布");
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [leaseToken, setLeaseToken] = useState("");
  const leaseTokenRef = useRef("");
  const leaseRefresh = useRef<Promise<boolean> | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [draftCandidate, setDraftCandidate] = useState<Awaited<ReturnType<typeof readCanvasDraft>> | null>(null);
  const [createMenu, setCreateMenu] = useState<CreateMenu | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [assetPanel, setAssetPanel] = useState(false);
  const [assetTargetNodeId, setAssetTargetNodeId] = useState<string | null>(null);
  const [assets, setAssets] = useState<CanvasProjectAsset[]>([]);
  const assetsRef = useRef<CanvasProjectAsset[]>([]);
  const [assetTab, setAssetTab] = useState<"project" | "global">("project");
  const [assetCategory, setAssetCategory] = useState<"all" | AssetCategory>("all");
  const [globalAssets, setGlobalAssets] = useState<LibraryAsset[]>([]);
  const globalAssetRequest = useRef(0);
  const [videoModels, setVideoModels] = useState<ModelCapability[]>([]);
  const imageModels = imageModelCatalog?.Items ?? EMPTY_IMAGE_MODELS;
  const imageRatios = imageModelCatalog?.Ratios ?? EMPTY_IMAGE_RATIOS;
  const [assetSearch, setAssetSearch] = useState("");
  const [uploading, setUploading] = useState<CanvasUploadItem[]>([]);
  const uploadBatchControllers = useRef(new Set<AbortController>());
  const browserOperationControllers = useRef(new Set<AbortController>());
  const browserWorkers = useRef(new Set<Worker>());
  const ephemeralNodeIds = useRef(new Set<string>());
  const localPreviewUrls = useRef(new Map<string, string>());
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const localAssetPreviewUrls = useRef(new Map<string, string>());
  const [localAssetPreviews, setLocalAssetPreviews] = useState<Record<string, string>>({});
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [inspectAsset, setInspectAsset] = useState<CanvasProjectAsset | null>(null);
  const [cropNodeId, setCropNodeId] = useState<string | null>(null);
  const [montageOpen, setMontageOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [expandedTextNodeId, setExpandedTextNodeId] = useState<string | null>(null);
  const [edgesHidden, setEdgesHidden] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [panMode, setPanMode] = useState(false);
  const [mobile, setMobile] = useState(matchMedia("(max-width: 820px)").matches);
  const initialized = useRef(false);
  const localDraftTimer = useRef<number | undefined>(undefined);
  const serverSaveTimer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<void> | null>(null);
  const saveAgain = useRef(false);
  const pendingSaveDocument = useRef<CanvasDocumentV2 | undefined>(undefined);
  const flushSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const latestDocument = useRef<CanvasDocumentV2>(defaultCanvasDocumentV2());
  const history = useRef<CanvasDocumentV2[]>([]);
  const historyCursor = useRef(-1);
  const historyTimer = useRef<number | undefined>(undefined);
  const rootMenuTimer = useRef<number | undefined>(undefined);
  const restoringHistory = useRef(false);
  const copiedSelection = useRef<{ nodes: CanvasNodeV2[]; edges: Array<{ source: string; target: string }> } | null>(null);
  const dragCopy = useRef<{ draggedId: string; cloneIds: Set<string>; originalPositions: Map<string, { x: number; y: number }> } | null>(null);
  const extractFrameRef = useRef<(id: string) => void>(() => undefined);
  const deriveImageRef = useRef<(id: string, operation: { cropRatio?: number; rotation?: 90 | 180 | 270 }) => void>(() => undefined);
  const uploadNodeFileRef = useRef<(id: string, file: File) => void>(() => undefined);
  const openNodeAssetPickerRef = useRef<(id: string) => void>(() => undefined);
  const composerRef = useRef<HTMLDivElement>(null);
  const textSelections = useRef(new Map<string, string>());
  const cid = useMemo(clientId, []);

  const showLocalPreview = useCallback((nodeId: string, blob: Blob) => {
    const previous = localPreviewUrls.current.get(nodeId);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    localPreviewUrls.current.set(nodeId, url);
    setLocalPreviews((current) => ({ ...current, [nodeId]: url }));
  }, []);

  const clearLocalPreview = useCallback((nodeId: string) => {
    const url = localPreviewUrls.current.get(nodeId);
    if (url) URL.revokeObjectURL(url);
    localPreviewUrls.current.delete(nodeId);
    setLocalPreviews((current) => {
      if (!(nodeId in current)) return current;
      const next = { ...current }; delete next[nodeId]; return next;
    });
  }, []);

  const showLocalAssetPreview = useCallback((assetId: string, blob: Blob) => {
    const previous = localAssetPreviewUrls.current.get(assetId);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    localAssetPreviewUrls.current.set(assetId, url);
    setLocalAssetPreviews((current) => ({ ...current, [assetId]: url }));
  }, []);

  const clearLocalAssetPreview = useCallback((assetId: string) => {
    const url = localAssetPreviewUrls.current.get(assetId);
    if (url) URL.revokeObjectURL(url);
    localAssetPreviewUrls.current.delete(assetId);
    setLocalAssetPreviews((current) => {
      if (!(assetId in current)) return current;
      const next = { ...current }; delete next[assetId]; return next;
    });
  }, []);

  const rememberLocalAssetPreview = useCallback((assetId: string, blob?: Blob) => {
    if (!blob) return;
    showLocalAssetPreview(assetId, blob);
    void storePendingAssetPreview(user.id, canvasPreviewCacheId(canvasId, assetId), blob);
  }, [canvasId, showLocalAssetPreview, user.id]);

  const adoptLease = useCallback((token: string) => {
    leaseTokenRef.current = token;
    setLeaseToken(token);
    setReadOnly(false);
  }, []);

  const recoverLease = useCallback(async () => {
    if (leaseRefresh.current) return leaseRefresh.current;
    const run = async () => {
      try {
        const currentToken = leaseTokenRef.current;
        if (currentToken) {
          const response = await renewCanvasLease(canvasId, cid, currentToken);
          if (response.ok) return true;
          if (response.status !== 409) throw new Error(response.status === 401 ? "登录已过期，请重新登录" : `编辑状态确认失败 (${response.status})`);
        }
        const lease = await acquireCanvasLease(canvasId, cid);
        if (lease.acquired) {
          adoptLease(lease.token);
          setSaveState((state) => state === "saved" ? state : "draft");
          setMessage("编辑连接已恢复，正在同步本地改动");
          return true;
        }
        leaseTokenRef.current = "";
        setLeaseToken("");
        setReadOnly(true);
        setSaveState("conflict");
        setMessage("另一个窗口正在编辑，本地草稿仍安全保留");
        return false;
      } catch {
        setSaveState(navigator.onLine ? "error" : "offline");
        setMessage(navigator.onLine ? "编辑连接暂时不稳定，改动已保存在本地，将自动重试" : "网络已断开，改动已保存在本地");
        return false;
      }
    };
    const pending = run().finally(() => { if (leaseRefresh.current === pending) leaseRefresh.current = null; });
    leaseRefresh.current = pending;
    return pending;
  }, [adoptLease, canvasId, cid]);

  useEffect(() => () => {
    for (const controller of uploadBatchControllers.current) controller.abort();
    uploadBatchControllers.current.clear();
    for (const controller of browserOperationControllers.current) controller.abort();
    browserOperationControllers.current.clear();
    for (const worker of browserWorkers.current) worker.terminate();
    browserWorkers.current.clear();
    for (const url of localPreviewUrls.current.values()) URL.revokeObjectURL(url);
    localPreviewUrls.current.clear();
    for (const url of localAssetPreviewUrls.current.values()) URL.revokeObjectURL(url);
    localAssetPreviewUrls.current.clear();
  }, []);

  const patchNode = useCallback((id: string, patch: Partial<CanvasNodeV2["data"]>) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, domain: { ...node.data.domain, data: { ...node.data.domain.data, ...patch } } } } : node));
  }, [setNodes]);

  const openComposer = useCallback((id: string) => {
    const node = flow.getNode(id);
    if (!node || readOnly) return;
    const kind = node.data.domain.type === "text" ? "text" : node.data.domain.type === "video" ? "video" : node.data.domain.type === "character" ? "character_tool" : "image";
    const imageModel = imageModels[0];
    const videoModel = canvasVideoModelsForReferences(videoModels, canvasReferenceKinds(id, flow.getNodes(), flow.getEdges()))[0];
    if ((kind === "image" || kind === "character_tool") && !imageModel) return setMessage("图片模型能力尚未载入，请稍后重试");
    if (kind === "video" && !videoModel) return setMessage("没有模型支持当前已连接素材的类型或数量");
    const model = kind === "image" || kind === "character_tool" ? imageModel?.id ?? "" : videoModel?.id ?? "";
    const ratio = kind === "video" ? (videoModel?.ratios.includes("adaptive") ? "adaptive" : videoModel?.ratios[0] ?? "16:9") : (imageRatios.includes("16:9") ? "16:9" : imageRatios[0] ?? "1:1");
    const resolution = kind === "video" ? (videoModel?.resolutions.includes("1080p") ? "1080p" : videoModel?.resolutions[0] ?? "720p") : imageModel?.defaultResolution ?? "1024";
    const duration = kind === "video" ? Math.max(videoModel?.duration[0] ?? 4, Math.min(6, videoModel?.duration[1] ?? 6)) : 6;
    const selectionText = textSelections.current.get(id) ?? "";
    setComposer({ nodeId: id, kind, prompt: node.data.domain.data.prompt ?? "", model, ratio, resolution, duration, tool: "turnaround", portraitStyle: "自然真实", strength: "标准", textAction: selectionText ? "replace_selection" : "overwrite", selectionText });
  }, [flow, imageModels, imageRatios, readOnly, videoModels]);

  useEffect(() => { assetsRef.current = assets; }, [assets]);
  const inspectNode = useCallback((id: string) => {
    const assetId = flow.getNode(id)?.data.domain.data.projectAssetId;
    setInspectAsset(assetsRef.current.find((asset) => asset.id === assetId) ?? null);
  }, [flow]);

  const cancelNodeJob = useCallback(async (id: string) => {
    const jobId = flow.getNode(id)?.data.domain.data.jobId;
    if (!jobId) return;
    try {
      await cancelCanvasJob(canvasId, jobId);
      const node = flow.getNode(id)?.data.domain.data;
      patchNode(id, { status: "idle", jobId: undefined, error: undefined, markdown: typeof node?.polarisBaseMarkdown === "string" ? node.polarisBaseMarkdown : node?.markdown });
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "取消任务失败"); }
  }, [canvasId, flow, patchNode]);

  const focusReference = useCallback((sourceId: string) => {
    const source = flow.getNode(sourceId);
    if (!source) return;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === sourceId })));
    const internal = flow.getInternalNode(sourceId);
    const position = internal?.internals.positionAbsolute ?? source.position;
    void flow.setCenter(position.x + (source.measured?.width ?? source.data.domain.width) / 2, position.y + (source.measured?.height ?? source.data.domain.height) / 2, { zoom: flow.getZoom(), duration: 280 });
  }, [flow, setNodes]);

  const removeReference = useCallback((sourceId: string, targetId: string) => {
    if (readOnly) return;
    setEdges((current) => current.filter((edge) => !(edge.source === sourceId && edge.target === targetId)));
    setMessage("已移除引用关系");
  }, [readOnly, setEdges]);

  const openCreateFrom = useCallback((id: string, side: "left" | "right", anchor: CanvasMenuAnchor) => {
    const node = flow.getNode(id);
    if (!node) return;
    const position = { x: node.position.x + (side === "right" ? (node.measured?.width ?? node.data.domain.width) + 130 : -430), y: node.position.y };
    setCreateMenu({ sourceId: id, side, position, anchor, focusOnOpen: true });
  }, [flow]);

  const attachCallbacks = useCallback((domain: CanvasNodeV2): CanvasFlowData => ({ domain, readOnly: readOnly || mobile, references: [], expandedText: false, onChange: patchNode, onCreateFrom: openCreateFrom, onFocusReference: focusReference, onRemoveReference: removeReference, onGenerate: openComposer, onInspect: inspectNode, onCancel: cancelNodeJob, onExtractFrame: (id) => extractFrameRef.current(id), onCrop: (id) => setCropNodeId(id), onRotate: (id) => deriveImageRef.current(id, { rotation: 90 }), onUpload: (id, file) => uploadNodeFileRef.current(id, file), onPickAsset: (id) => openNodeAssetPickerRef.current(id), onSelection: (id, text) => { if (text) textSelections.current.set(id, text); else textSelections.current.delete(id); }, onExpandText: (id, expanded) => setExpandedTextNodeId(expanded ? id : null) }), [cancelNodeJob, focusReference, inspectNode, mobile, openComposer, openCreateFrom, patchNode, readOnly, removeReference]);
  const makeFlowNode = useCallback((domain: CanvasNodeV2): CanvasFlowNode => ({ id: domain.id, type: domain.type, position: domain.position, parentId: domain.parentId, extent: domain.parentId ? "parent" : undefined, width: domain.width, height: domain.height, dragHandle: ".canvas-v2-node", data: attachCallbacks(domain) }), [attachCallbacks]);

  useEffect(() => {
    setNodes((current) => current.map((node) => ({ ...node, data: attachCallbacks(node.data.domain), dragHandle: ".canvas-v2-node", draggable: !(readOnly || mobile) })));
  }, [attachCallbacks, mobile, readOnly, setNodes]);

  const documentFromFlow = useCallback((override?: { nodes: readonly CanvasFlowNode[]; edges: readonly Edge[] }): CanvasDocumentV2 => {
    const graph = withoutEphemeralCanvasElements(override?.nodes ?? flow.getNodes(), override?.edges ?? flow.getEdges(), ephemeralNodeIds.current);
    return {
      version: 2,
      viewport: (() => { const viewport = flow.getViewport(); return { x: viewport.x, y: viewport.y, k: viewport.zoom }; })(),
      background: "dots",
      preferences: { edgesHidden, snapToGrid, minimapOpen, panMode },
      nodes: graph.nodes.map((node) => ({ ...node.data.domain, position: node.position, width: node.measured?.width ?? node.width ?? node.data.domain.width, height: node.measured?.height ?? node.height ?? node.data.domain.height, parentId: node.parentId })),
      connections: graph.connections.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: "right", targetHandle: "left", relation: "context" })),
    };
  }, [edgesHidden, flow, minimapOpen, panMode, snapToGrid]);

  const hydrate = useCallback((document: CanvasDocumentV2) => {
    setEdgesHidden(document.preferences.edgesHidden); setSnapToGrid(document.preferences.snapToGrid); setMinimapOpen(document.preferences.minimapOpen); setPanMode(document.preferences.panMode);
    setNodes([...document.nodes].sort((left, right) => Number(right.type === "group") - Number(left.type === "group")).map(makeFlowNode)); setEdges(document.connections.map(toEdge));
    requestAnimationFrame(() => flow.setViewport({ x: document.viewport.x, y: document.viewport.y, zoom: document.viewport.k }));
    latestDocument.current = document;
  }, [flow, makeFlowNode, setEdges, setNodes]);

  const load = useCallback(async () => {
    setLoadState("loading"); setMessage("");
    try {
      const mobileViewer = matchMedia("(max-width: 820px)").matches;
      const [project, lease, localDraft] = await Promise.all([getCanvasV2(canvasId), mobileViewer ? Promise.resolve({ acquired: false as const, ttlMs: 30_000 }) : acquireCanvasLease(canvasId, cid), readCanvasDraft(canvasId).catch(() => undefined)]);
      if (!project.document) throw new Error("画布文档无法解析");
      const document = toCanvasDocumentV2(project.document);
      setProjectTitle(project.title); setRevision(project.revision); revisionRef.current = project.revision;
      if (lease.acquired) adoptLease(lease.token);
      else {
        leaseTokenRef.current = ""; setLeaseToken(""); setReadOnly(true); setSaveState("conflict");
        setMessage("另一个窗口正在编辑；当前已安全打开为只读模式");
      }
      hydrate(document);
      history.current = [structuredClone(document)]; historyCursor.current = 0;
      if (localDraft && localDraft.savedAt > project.updatedAt && localDraft.revision >= project.revision) setDraftCandidate(localDraft);
      initialized.current = true; setLoadState("ready");
    } catch (error) { setMessage(error instanceof Error ? error.message : "画布暂时无法载入"); setLoadState("error"); }
  }, [adoptLease, canvasId, cid, hydrate]);

  const takeoverLease = async () => {
    try {
      const lease = await acquireCanvasLease(canvasId, cid, true);
      if (!lease.acquired) throw new Error("暂时无法接管编辑权");
      adoptLease(lease.token); setSaveState("draft"); setMessage("已接管编辑，本地草稿仍保留");
    } catch (error) { setMessage(error instanceof Error ? error.message : "接管失败"); }
  };

  useEffect(() => {
    void load();
    return () => { initialized.current = false; window.clearTimeout(rootMenuTimer.current); };
  // Canvas identity is the load boundary. Callback identity changes must never remount an active editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".canvas-v2-account")) setProfileOpen(false);
      if (!target?.closest(".canvas-v2-help")) setHelpOpen(false);
      if (!target?.closest(".canvas-v2-create-menu,.canvas-v2-node__plus,.canvas-v2-pill__add")) setCreateMenu(null);
    };
    const dismissOnResize = () => setCreateMenu(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismissOnResize);
    };
  }, []);
  useEffect(() => {
    if (!createMenu?.focusOnOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    let openedMenu: HTMLDivElement | null = null;
    const frame = requestAnimationFrame(() => { openedMenu = createMenuRef.current; openedMenu?.querySelector<HTMLElement>("button")?.focus(); });
    return () => {
      cancelAnimationFrame(frame);
      if (openedMenu?.contains(document.activeElement)) opener?.focus();
    };
  }, [createMenu]);
  useEffect(() => {
    if (!assetPanel && !composer && !inspectAsset && !cropNodeId && !montageOpen && !shortcutOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const dialogs = document.querySelectorAll<HTMLElement>(".canvas-v2-workspace [role=dialog]");
      const dialog = dialogs.item(dialogs.length - 1);
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])');
      focusable?.item(0)?.focus();
    }, 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialogs = document.querySelectorAll<HTMLElement>(".canvas-v2-workspace [role=dialog]");
      const dialog = dialogs.item(dialogs.length - 1);
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [assetPanel, composer, cropNodeId, inspectAsset, montageOpen, shortcutOpen]);
  useEffect(() => {
    let active = true;
    void api.get<ModelCapability[]>("/api/models").then((videos) => { if (active) setVideoModels(videos); }).catch(() => { if (active) setMessage((current) => current || "视频模型能力暂时无法载入，画布编辑不受影响"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const unavailable = "图片模型能力暂时无法载入，网络恢复后会自动重试";
    if (imageModelCatalogError && !imageModelCatalog) setMessage((current) => current || unavailable);
    else setMessage((current) => current === unavailable ? "" : current);
  }, [imageModelCatalog, imageModelCatalogError]);
  useEffect(() => { const media = matchMedia("(max-width: 820px)"); const update = () => setMobile(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => {
    if (!mobile || !leaseToken) return;
    void releaseCanvasLease(canvasId, cid, leaseToken);
    leaseTokenRef.current = ""; setLeaseToken(""); setReadOnly(true);
  }, [canvasId, cid, leaseToken, mobile]);

  const flushSave = useCallback(async (documentOverride?: CanvasDocumentV2) => {
    if (!initialized.current || readOnly || !leaseTokenRef.current) return;
    if (documentOverride) pendingSaveDocument.current = documentOverride;
    if (saving.current) { saveAgain.current = true; await saving.current; return; }
    const run = async () => {
      setSaveState(navigator.onLine ? "saving" : "offline");
      const document = pendingSaveDocument.current ?? documentFromFlow(); pendingSaveDocument.current = undefined; latestDocument.current = document;
      await writeCanvasDraft({ canvasId, revision: revisionRef.current, document, savedAt: Date.now() }).catch(() => undefined);
      if (!navigator.onLine) return;
      const persist = async () => {
        const saved = await saveCanvasV2(canvasId, revisionRef.current, document, leaseTokenRef.current);
        revisionRef.current = saved.revision; setRevision(saved.revision); setSaveState("saved");
        await deleteCanvasDraft(canvasId).catch(() => undefined);
      };
      try {
        await persist();
      } catch (error) {
        let typed = error as Error & { status?: number; code?: string };
        if (typed.code === "CANVAS_LEASE_LOST") {
          if (!await recoverLease()) return;
          try { await persist(); return; }
          catch (retryError) { typed = retryError as Error & { status?: number; code?: string }; }
        }
        if (typed.status === 409) { setSaveState("conflict"); setMessage(typed.message); }
        else { setSaveState(navigator.onLine ? "error" : "offline"); setMessage(typed.message); }
      }
    };
    saving.current = run().finally(() => { saving.current = null; });
    await saving.current;
    if (saveAgain.current || pendingSaveDocument.current) { saveAgain.current = false; await flushSave(); }
  }, [canvasId, documentFromFlow, readOnly, recoverLease]);
  useEffect(() => { flushSaveRef.current = flushSave; }, [flushSave]);

  const scheduleSave = useCallback(() => {
    if (!initialized.current || readOnly) return;
    setSaveState("draft");
    window.clearTimeout(localDraftTimer.current); window.clearTimeout(serverSaveTimer.current);
    localDraftTimer.current = window.setTimeout(() => { const document = documentFromFlow(); latestDocument.current = document; void writeCanvasDraft({ canvasId, revision: revisionRef.current, document, savedAt: Date.now() }); }, 250);
    serverSaveTimer.current = window.setTimeout(() => void flushSave(), 800);
  }, [canvasId, documentFromFlow, flushSave, readOnly]);

  useEffect(() => { if (initialized.current) scheduleSave(); }, [nodes, edges, edgesHidden, minimapOpen, panMode, scheduleSave, snapToGrid]);
  useEffect(() => {
    const persistLocalDraft = () => {
      if (!initialized.current || readOnly) return;
      window.clearTimeout(localDraftTimer.current);
      const document = documentFromFlow();
      latestDocument.current = document;
      void writeCanvasDraft({ canvasId, revision: revisionRef.current, document, savedAt: Date.now() }).catch(() => undefined);
    };
    window.addEventListener("pagehide", persistLocalDraft);
    return () => {
      window.removeEventListener("pagehide", persistLocalDraft);
      persistLocalDraft();
    };
  }, [canvasId, documentFromFlow, readOnly]);
  useEffect(() => {
    if (!leaseToken) return;
    const renew = () => void recoverLease();
    const recoverAndFlush = () => void recoverLease().then((available) => { if (available) return flushSaveRef.current(); });
    const timer = window.setInterval(renew, 10_000);
    const onVisibility = () => { if (document.visibilityState === "visible") recoverAndFlush(); else void flushSaveRef.current(); };
    const onOnline = recoverAndFlush;
    document.addEventListener("visibilitychange", onVisibility); window.addEventListener("online", onOnline);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("online", onOnline); void releaseCanvasLease(canvasId, cid, leaseToken); };
  }, [canvasId, cid, leaseToken, recoverLease]);

  const refreshAssets = useCallback(async () => {
    const result = await listCanvasAssets(canvasId); setAssets(result.Items);
    const byId = new Map(result.Items.map((asset) => [asset.id, asset]));
    setNodes((current) => current.map((node) => {
      const asset = node.data.domain.data.projectAssetId ? byId.get(node.data.domain.data.projectAssetId) : undefined;
      if (!asset) return node;
      const status = asset.status === "ready" ? "succeeded" : asset.status === "failed" ? "failed" : "running";
      return { ...node, data: { ...node.data, domain: { ...node.data.domain, data: { ...node.data.domain.data, status, error: asset.status === "failed" ? "素材归档失败，可从资产面板重试上传" : undefined } } } };
    }));
  }, [canvasId, setNodes]);
  useEffect(() => {
    if (!assets.some((asset) => asset.status === "copying")) return;
    const timer = window.setTimeout(() => void refreshAssets(), document.hidden ? 10_000 : 1500);
    return () => window.clearTimeout(timer);
  }, [assets, refreshAssets]);
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      for (const asset of assets) {
        if (asset.kind !== "image" || asset.status === "ready" || localAssetPreviewUrls.current.has(asset.id)) continue;
        const blob = await readPendingAssetPreview(user.id, canvasPreviewCacheId(canvasId, asset.id));
        if (cancelled || !blob || localAssetPreviewUrls.current.has(asset.id)) continue;
        showLocalAssetPreview(asset.id, blob);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [assets, canvasId, showLocalAssetPreview, user.id]);
  useEffect(() => {
    for (const asset of assets) {
      if (asset.status !== "ready" || !localAssetPreviewUrls.current.has(asset.id)) continue;
      clearLocalAssetPreview(asset.id);
      void removePendingAssetPreview(user.id, canvasPreviewCacheId(canvasId, asset.id));
    }
  }, [assets, canvasId, clearLocalAssetPreview, user.id]);
  useEffect(() => {
    if (!Object.keys(localPreviews).length) return;
    const ready = new Set(assets.filter((asset) => asset.status === "ready").map((asset) => asset.id));
    for (const node of nodes) {
      if (localPreviews[node.id] && node.data.domain.data.projectAssetId && ready.has(node.data.domain.data.projectAssetId)) clearLocalPreview(node.id);
    }
  }, [assets, clearLocalPreview, localPreviews, nodes]);

  const applyJob = useCallback((job: CanvasJob) => {
    setNodes((current) => {
      const target = current.find((node) => node.id === job.nodeId);
      if (!target) return current;
      const status: CanvasNodeV2["data"]["status"] = job.status === "cancelled" ? "idle" : job.status;
      const data = target.data.domain.data;
      const base = typeof data.polarisBaseMarkdown === "string" ? data.polarisBaseMarkdown : data.markdown ?? "";
      const selection = typeof data.polarisSelectionText === "string" ? data.polarisSelectionText : "";
      const action = data.polarisAction;
      const polarisMarkdown = action === "append" ? [base, job.partialText].filter(Boolean).join("\n\n") : action === "replace_selection" && selection && base.includes(selection) ? base.replace(selection, job.partialText) : job.partialText;
      const patch = job.kind === "text" ? { status, jobId: job.id, markdown: job.partialText ? polarisMarkdown : data.markdown, error: job.error } : { status, jobId: job.id, projectAssetId: job.resultAssetId ?? data.projectAssetId, error: job.error };
      return current.map((node) => node.id === job.nodeId ? { ...node, data: { ...node.data, domain: { ...node.data.domain, data: { ...node.data.domain.data, ...patch } } } } : node);
    });
    if (job.status === "succeeded" && job.resultAssetId) void refreshAssets();
  }, [refreshAssets, setNodes]);

  const jobCursor = useRef(0);
  const activeJobs = useRef(new Set<string>());
  const [hasActiveJobs, setHasActiveJobs] = useState(false);
  const acceptJob = useCallback((job: CanvasJob) => {
    jobCursor.current = Math.max(jobCursor.current, job.updatedAt);
    if (["queued", "running"].includes(job.status)) activeJobs.current.add(job.id);
    else activeJobs.current.delete(job.id);
    setHasActiveJobs(activeJobs.current.size > 0);
    applyJob(job);
  }, [applyJob]);
  const refreshJobs = useCallback(async () => {
    const { Items } = await listCanvasJobs(canvasId, Math.max(0, jobCursor.current - 1));
    Items.forEach(acceptJob);
  }, [acceptJob, canvasId]);

  useEffect(() => {
    jobCursor.current = 0;
    activeJobs.current.clear();
    setHasActiveJobs(false);
    if (loadState === "ready") void Promise.all([refreshAssets(), refreshJobs()]);
  }, [canvasId, loadState, refreshAssets, refreshJobs]);
  useAdaptiveRefresh(loadState === "ready", hasActiveJobs, refreshJobs);

  useEffect(() => {
    if (loadState !== "ready") return;
    const events = new EventSource(`/api/canvases/${encodeURIComponent(canvasId)}/events`);
    events.addEventListener("canvas_job", (event) => { try { acceptJob(JSON.parse((event as MessageEvent).data) as CanvasJob); } catch { /* ignore */ } });
    return () => events.close();
  }, [acceptJob, canvasId, loadState]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => onNodesChangeBase(changes), [onNodesChangeBase]);
  const onConnect = useCallback((connection: Connection) => {
    if (readOnly || !connection.source || !connection.target || connection.source === connection.target) return;
    const source = flow.getNode(connection.source)?.data.domain.type;
    const target = flow.getNode(connection.target)?.data.domain.type;
    if (!source || !target || !canCreateFromNode(source, target)) { setMessage("这两类节点不能建立上下文关系"); return; }
    if (hasCanvasConnection(flow.getEdges(), connection.source, connection.target)) { setMessage("这两个节点已经建立引用关系"); return; }
    setEdges((current) => addEdge({ ...connection, id: `edge-${crypto.randomUUID()}`, sourceHandle: "right", targetHandle: "left", type: "bezier", markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 }, style: edgeStyle }, current));
  }, [flow, readOnly, setEdges]);

  const createNode = useCallback((type: (typeof creatableTypes)[number] | "group") => {
    if (readOnly) return;
    const menu = createMenu;
    const source = menu?.sourceId ? flow.getNode(menu.sourceId) : undefined;
    if (source && menu?.side === "right" && !canCreateFromNode(source.data.domain.type, type)) return;
    if (source && menu?.side === "left" && !canCreateFromNode(type, source.data.domain.type)) return;
    const position = menu?.position ?? flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 });
    const domain = createCanvasNodeV2(type, position);
    setNodes((current) => [...current, makeFlowNode(domain)]);
    if (source && menu?.side) setEdges((current) => [...current, toEdge({ id: `edge-${crypto.randomUUID()}`, source: menu.side === "right" ? source.id : domain.id, target: menu.side === "right" ? domain.id : source.id, sourceHandle: "right", targetHandle: "left", relation: "context" })]);
    setCreateMenu(null);
    requestAnimationFrame(() => flow.setNodes((current) => current.map((node) => ({ ...node, selected: node.id === domain.id }))));
  }, [createMenu, flow, makeFlowNode, readOnly, setEdges, setNodes]);

  const allowedCreateTypes = useMemo(() => {
    if (!createMenu?.sourceId || !createMenu.side) return [...creatableTypes, "group" as const];
    const sourceType = flow.getNode(createMenu.sourceId)?.data.domain.type;
    if (!sourceType || sourceType === "group" || sourceType === "legacy-audio") return [];
    return createMenu.side === "right" ? NODE_CONNECTION_MATRIX[sourceType] : creatableTypes.filter((type) => canCreateFromNode(type, sourceType));
  }, [createMenu, flow]);

  const renderedNodes = useMemo(() => {
    const domains = nodes.map((node) => node.data.domain);
    return nodes.map((node) => ({
      ...node,
      data: { ...node.data, references: incomingCanvasReferences(node.id, domains, edges), expandedText: expandedTextNodeId === node.id, localPreviewUrl: localPreviews[node.id] ?? (node.data.domain.data.projectAssetId ? localAssetPreviews[node.data.domain.data.projectAssetId] : undefined) },
    }));
  }, [edges, expandedTextNodeId, localAssetPreviews, localPreviews, nodes]);

  useEffect(() => {
    if (expandedTextNodeId && !nodes.some((node) => node.id === expandedTextNodeId)) setExpandedTextNodeId(null);
  }, [expandedTextNodeId, nodes]);
  const renderedEdges = useMemo(() => edges.map((edge) => ({ ...edge, hidden: edgesHidden })), [edges, edgesHidden]);

  const createMenuStyle = useMemo<CreateMenuStyle | undefined>(() => {
    if (!createMenu) return undefined;
    const height = 54 + allowedCreateTypes.length * 40;
    if (createMenu.anchor) {
      const placed = placeCanvasMenu(createMenu.anchor, { width: 224, height }, { width: innerWidth, height: innerHeight }, createMenu.side === "left" ? "left" : "right");
      return { left: placed.left, top: placed.top, placement: placed.placement, "--canvas-menu-arrow-top": `${placed.arrowTop}px` };
    }
    return {
      left: Math.max(12, Math.min(createMenu.screen?.x ?? innerWidth / 2 - 112, innerWidth - 236)),
      top: Math.max(12, Math.min(createMenu.screen?.y ?? innerHeight / 2 - height / 2, innerHeight - height - 12)),
      placement: undefined,
    };
  }, [allowedCreateTypes.length, createMenu]);

  const selectedVideoAssets = useMemo(() => nodes.filter((node) => node.selected && node.data.domain.type === "video" && node.data.domain.data.projectAssetId).map((node) => assets.find((asset) => asset.id === node.data.domain.data.projectAssetId)).filter((asset): asset is CanvasProjectAsset => Boolean(asset && asset.status === "ready")), [assets, nodes]);
  const selectedAssets = useMemo(() => nodes.filter((node) => node.selected && node.data.domain.data.projectAssetId).map((node) => assets.find((asset) => asset.id === node.data.domain.data.projectAssetId)).filter((asset): asset is CanvasProjectAsset => Boolean(asset)), [assets, nodes]);
  const assetTargetNode = assetTargetNodeId ? nodes.find((node) => node.id === assetTargetNodeId) : undefined;
  const visibleProjectAssets = useMemo(() => assets.filter((asset) =>
    asset.title.toLowerCase().includes(assetSearch.toLowerCase())
    && (!assetTargetNode || acceptsProjectAsset(assetTargetNode.data.domain.type, asset.kind))), [assetSearch, assetTargetNode, assets]);
  const visibleGlobalAssets = assetTargetNode?.data.domain.type === "video" ? [] : globalAssets;
  const selectedNodeCount = useMemo(() => nodes.filter((node) => node.selected).length, [nodes]);
  const selectedGroupCount = useMemo(() => nodes.filter((node) => node.selected && node.data.domain.type === "group").length, [nodes]);
  const composerNode = composer?.kind === "video" ? nodes.find((node) => node.id === composer.nodeId) : undefined;
  const composerReferences = composer ? incomingCanvasReferences(composer.nodeId, nodes.map((node) => node.data.domain), edges) : [];
  const composerReferenceKinds = composerNode ? canvasReferenceKinds(composerNode.id, nodes, edges) : [];
  const compatibleVideoModels = canvasVideoModelsForReferences(videoModels, composerReferenceKinds);
  const activeVideoModel = composer?.kind === "video" ? compatibleVideoModels.find((model) => model.id === composer.model) : undefined;
  const activeImageModel = composer && (composer.kind === "image" || composer.kind === "character_tool") ? imageModels.find((model) => model.id === composer.model) : undefined;

  useEffect(() => {
    if (!initialized.current || restoringHistory.current) return;
    window.clearTimeout(historyTimer.current);
    historyTimer.current = window.setTimeout(() => {
      const document = documentFromFlow();
      const current = history.current[historyCursor.current];
      if (current && JSON.stringify(current) === JSON.stringify(document)) return;
      history.current = [...history.current.slice(0, historyCursor.current + 1), structuredClone(document)].slice(-50);
      historyCursor.current = history.current.length - 1;
    }, 420);
    return () => window.clearTimeout(historyTimer.current);
  }, [documentFromFlow, edges, edgesHidden, minimapOpen, nodes, panMode, snapToGrid]);

  const restoreHistoryAt = (index: number) => {
    const snapshot = history.current[index];
    if (!snapshot) return;
    restoringHistory.current = true; historyCursor.current = index; hydrate(structuredClone(snapshot));
    window.setTimeout(() => { restoringHistory.current = false; }, 500);
  };

  const groupSelected = () => {
    const selected = nodes.filter((node) => node.selected && !node.parentId && node.data.domain.type !== "group");
    if (selected.length < 2) return setMessage("请至少选择两个未分组节点");
    const left = Math.min(...selected.map((node) => node.position.x)) - 36;
    const top = Math.min(...selected.map((node) => node.position.y)) - 54;
    const right = Math.max(...selected.map((node) => node.position.x + (node.measured?.width ?? node.data.domain.width))) + 36;
    const bottom = Math.max(...selected.map((node) => node.position.y + (node.measured?.height ?? node.data.domain.height))) + 36;
    const domain = createCanvasNodeV2("group", { x: left, y: top }, { width: right - left, height: bottom - top, title: "镜头组" });
    setNodes((current) => [
      { ...makeFlowNode(domain), selected: true },
      ...current.map((node) => selected.some((item) => item.id === node.id) ? { ...node, parentId: domain.id, extent: "parent" as const, selected: false, position: { x: node.position.x - left, y: node.position.y - top }, data: { ...node.data, domain: { ...node.data.domain, parentId: domain.id, position: { x: node.position.x - left, y: node.position.y - top } } } } : { ...node, selected: false }),
    ]);
  };

  const ungroupSelected = () => {
    const groups = nodes.filter((node) => node.selected && node.data.domain.type === "group");
    if (!groups.length) return setMessage("请先选择一个分组");
    const byId = new Map(groups.map((group) => [group.id, group]));
    setNodes((current) => current.filter((node) => !byId.has(node.id)).map((node) => {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (!parent) return node;
      const position = { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y };
      return { ...node, parentId: undefined, extent: undefined, selected: true, position, data: { ...node.data, domain: { ...node.data.domain, parentId: undefined, position } } };
    }));
  };

  const duplicateSelection = (source = copiedSelection.current) => {
    const selectedFlow = source ? [] : nodes.filter((node) => node.selected);
    const selected = source?.nodes ?? selectedFlow.map((node) => ({ ...structuredClone(node.data.domain), position: node.position, parentId: node.parentId }));
    if (!selected.length) return;
    const sourceEdges = source?.edges ?? edges.filter((edge) => selected.some((node) => node.id === edge.source) && selected.some((node) => node.id === edge.target)).map((edge) => ({ source: edge.source, target: edge.target }));
    const ids = new Map(selected.map((node) => [node.id, `node-${crypto.randomUUID()}`]));
    const copies = selected.map((node) => {
      const id = ids.get(node.id)!; const parentId = node.parentId ? ids.get(node.parentId) : undefined;
      const position = { x: node.position.x + 32, y: node.position.y + 32 };
      const domain = { ...structuredClone(node), id, parentId, position };
      return { ...makeFlowNode(domain), parentId, extent: parentId ? "parent" as const : undefined, selected: true };
    });
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current, ...sourceEdges.map((edge) => ({ ...edge, id: `edge-${crypto.randomUUID()}`, source: ids.get(edge.source)!, target: ids.get(edge.target)! }))]);
  };

  const copySelection = () => {
    const selected = nodes.filter((node) => node.selected);
    if (!selected.length) return;
    copiedSelection.current = {
      nodes: selected.map((node) => ({ ...structuredClone(node.data.domain), position: node.position, parentId: node.parentId })),
      edges: edges.filter((edge) => selected.some((node) => node.id === edge.source) && selected.some((node) => node.id === edge.target)).map((edge) => ({ source: edge.source, target: edge.target })),
    };
    setMessage(`已复制 ${selected.length} 个节点`);
  };

  const beginNodeDrag = (event: MouseEvent | TouchEvent, dragged: CanvasFlowNode) => {
    setCreateMenu(null);
    if (!(event instanceof MouseEvent) || !event.altKey || readOnly) { dragCopy.current = null; return; }
    const selected = flow.getNodes().filter((node) => node.selected || node.id === dragged.id);
    const cloneIds = new Set((event.ctrlKey || event.metaKey ? selected : [dragged]).map((node) => node.id));
    dragCopy.current = { draggedId: dragged.id, cloneIds, originalPositions: new Map(selected.map((node) => [node.id, { ...node.position }])) };
  };

  const finishNodeDrag = () => {
    const session = dragCopy.current; dragCopy.current = null;
    if (!session) return;
    const current = flow.getNodes();
    const candidates = current.filter((node) => session.cloneIds.has(node.id));
    const idMap = new Map(candidates.map((node) => [node.id, `node-${crypto.randomUUID()}`]));
    const clones = candidates.map((node) => {
      const id = idMap.get(node.id)!;
      const domain = structuredClone(node.data.domain);
      domain.id = id; domain.position = { ...node.position }; domain.parentId = domain.parentId ? idMap.get(domain.parentId) ?? domain.parentId : undefined;
      return { ...makeFlowNode(domain), selected: true };
    });
    setNodes((nodesNow) => [...nodesNow.map((node) => session.originalPositions.has(node.id) ? { ...node, position: session.originalPositions.get(node.id)!, selected: false } : { ...node, selected: false }), ...clones]);
    const copiedEdges = flow.getEdges().filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge) => toEdge({ id: `edge-${crypto.randomUUID()}`, source: idMap.get(edge.source)!, target: idMap.get(edge.target)!, sourceHandle: "right", targetHandle: "left", relation: "context" }));
    if (copiedEdges.length) setEdges((currentEdges) => [...currentEdges, ...copiedEdges]);
  };

  const downloadSelected = async () => {
    let savedToDirectory = 0;
    const picker = (window as typeof window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (picker && selectedAssets.length > 1) {
      try {
        const directory = await picker();
        for (const [index, asset] of selectedAssets.entries()) {
          const response = await fetch(asset.downloadUrl);
          if (!response.ok || !response.body) throw new Error(`${asset.title} 下载失败 (${response.status})`);
          const handle = await directory.getFileHandle(canvasAssetDownloadName(asset, index), { create: true });
          const writable = await handle.createWritable();
          await response.body.pipeTo(writable);
          savedToDirectory += 1;
        }
        setMessage(`${selectedAssets.length} 个文件已保存到所选目录`); return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const remaining = selectedAssets.slice(savedToDirectory);
    for (const asset of remaining) {
      const anchor = document.createElement("a"); anchor.href = asset.downloadUrl; anchor.target = "_blank"; anchor.rel = "noopener"; anchor.click();
    }
    setMessage(savedToDirectory ? `${savedToDirectory} 个文件已保存；其余 ${remaining.length} 个已交给浏览器下载器` : `已将 ${remaining.length} 个文件交给浏览器下载器`);
  };

  const submitComposer = async () => {
    if (!composer) return;
    let targetId = composer.nodeId;
    let saveGraph: { nodes: CanvasFlowNode[]; edges: Edge[] } | undefined;
    const sourceNode = flow.getNode(composer.nodeId);
    const domain = sourceNode?.data.domain;
    const hasExistingContent = Boolean(domain && (domain.type === "text" ? domain.data.markdown?.trim() : domain.data.projectAssetId));
    const videoReferences = canvasReferenceKinds(composer.nodeId, flow.getNodes(), flow.getEdges());
    const videoMode = canvasVideoModeForReferences(videoReferences);
    const videoModel = composer.kind === "video" ? videoModels.find((model) => model.id === composer.model) : undefined;
    if (composer.kind === "video" && (!videoModel || !canvasVideoModelsForReferences([videoModel], videoReferences).length)) { setMessage("当前模型不支持已连接素材的类型或数量，请重新选择模型"); return; }
    if (sourceNode && domain && hasExistingContent && composer.kind !== "text") {
      const next = createCanvasNodeV2(domain.type === "legacy-audio" || domain.type === "group" ? "video" : domain.type, { x: sourceNode.position.x + (sourceNode.measured?.width ?? domain.width) + 140, y: sourceNode.position.y });
      targetId = next.id;
      const nextNode = { ...makeFlowNode(next), selected: true };
      const nextEdge = toEdge({ id: `edge-${crypto.randomUUID()}`, source: sourceNode.id, target: next.id, sourceHandle: "right", targetHandle: "left", relation: "context" });
      saveGraph = { nodes: [...flow.getNodes().map((node) => ({ ...node, selected: false })), nextNode], edges: [...flow.getEdges(), nextEdge] };
      setNodes(saveGraph.nodes);
      setEdges(saveGraph.edges);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    if (composer.kind === "text" && sourceNode) patchNode(targetId, { polarisAction: composer.textAction, polarisBaseMarkdown: sourceNode.data.domain.data.markdown ?? "", polarisSelectionText: composer.selectionText });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await flushSave(saveGraph ? documentFromFlow(saveGraph) : undefined);
    const currentRevision = revisionRef.current;
    let body: unknown;
    if (composer.kind === "text") body = { kind: "text", nodeId: targetId, revision: currentRevision, payload: { instruction: composer.prompt } };
    else if (composer.kind === "image") body = { kind: "image", nodeId: targetId, revision: currentRevision, payload: { prompt: composer.prompt, model: composer.model, ratio: composer.ratio, resolution: composer.resolution, referenceAssetIds: [] } };
    else if (composer.kind === "character_tool") body = { kind: "character_tool", nodeId: targetId, revision: currentRevision, payload: { tool: composer.tool, prompt: `${composer.prompt}\n人像质感：${composer.portraitStyle}；控制强度：${composer.strength}。`, model: composer.model, ratio: composer.ratio, resolution: composer.resolution, referenceAssetIds: [] } };
    else {
      body = { kind: "video", nodeId: targetId, revision: currentRevision, payload: { generation: { prompt: composer.prompt, model: composer.model, mode: videoMode, ratio: composer.ratio, resolution: composer.resolution, duration: composer.duration, generateAudio: videoModel?.supportsAudio ?? false, seed: -1, cameraFixed: false, watermark: false, outputFormat: "mp4" }, references: [] } };
    }
    try { const job = await createCanvasJob(canvasId, body); acceptJob(job); setComposer(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "任务提交失败"); }
  };

  const fillNodeWithAsset = useCallback((nodeId: string, asset: CanvasProjectAsset) => {
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      selected: true,
      data: {
        ...node.data,
        domain: {
          ...node.data.domain,
          title: asset.title,
          data: {
            ...node.data.domain.data,
            projectAssetId: asset.id,
            mimeType: asset.contentType,
            durationMs: asset.durationMs,
            status: asset.status === "ready" ? "succeeded" : asset.status === "failed" ? "failed" : "running",
            error: asset.status === "failed" ? "素材归档失败，请重新选择或上传" : undefined,
          },
        },
      },
    } : { ...node, selected: false }));
  }, [setNodes]);

  const insertAsset = useCallback((asset: CanvasProjectAsset) => {
    if (assetTargetNodeId) {
      const target = flow.getNode(assetTargetNodeId);
      if (!target) { setAssetTargetNodeId(null); setAssetPanel(false); return; }
      if (!acceptsProjectAsset(target.data.domain.type, asset.kind)) { setMessage("这个素材类型不能放入当前节点"); return; }
      fillNodeWithAsset(assetTargetNodeId, asset);
      setAssetTargetNodeId(null);
      setAssetPanel(false);
      setMessage(`已将「${asset.title}」放入节点`);
      return;
    }
    const type = asset.kind === "video" ? "video" : asset.kind === "audio" ? "legacy-audio" : "image";
    const position = flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 });
    const domain = createCanvasNodeV2(type === "legacy-audio" ? "video" : type, position, { title: asset.title, data: { projectAssetId: asset.id, mimeType: asset.contentType, durationMs: asset.durationMs, status: asset.status === "ready" ? "succeeded" : asset.status === "failed" ? "failed" : "running" } });
    if (type === "legacy-audio") domain.type = "legacy-audio";
    setNodes((current) => [...current, makeFlowNode(domain)]); setAssetPanel(false);
  }, [assetTargetNodeId, fillNodeWithAsset, flow, makeFlowNode, setNodes]);

  const createOptimisticImageNode = useCallback((sourceNode: CanvasFlowNode, title: string, blob: Blob) => {
    const position = { x: sourceNode.position.x + (sourceNode.measured?.width ?? sourceNode.data.domain.width) + 140, y: sourceNode.position.y };
    const domain = createCanvasNodeV2("image", position, { title, data: { mimeType: blob.type || "image/webp", status: "running" } });
    ephemeralNodeIds.current.add(domain.id);
    showLocalPreview(domain.id, blob);
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { ...makeFlowNode(domain), selected: true }]);
    setEdges((current) => [...current, toEdge({ id: `edge-${crypto.randomUUID()}`, source: sourceNode.id, target: domain.id, sourceHandle: "right", targetHandle: "left", relation: "context" })]);
    return domain.id;
  }, [makeFlowNode, setEdges, setNodes, showLocalPreview]);

  const extractFrame = useCallback((nodeId: string) => {
    const sourceNode = flow.getNode(nodeId);
    const assetId = sourceNode?.data.domain.data.projectAssetId;
    const sourceAsset = assets.find((asset) => asset.id === assetId && asset.kind === "video");
    if (!sourceNode || !sourceAsset) return setMessage("视频素材尚未准备完成");
    patchNode(nodeId, { status: "running", error: undefined });
    const worker = new Worker(new URL("./frame-extract.worker.ts", import.meta.url), { type: "module" });
    browserWorkers.current.add(worker);
    worker.onmessage = (event: MessageEvent<{ type: "complete"; buffer: ArrayBuffer; width: number; height: number } | { type: "error"; message: string }>) => {
      browserWorkers.current.delete(worker); worker.terminate();
      if (event.data.type === "error") { patchNode(nodeId, { status: "succeeded", error: event.data.message }); setMessage(event.data.message); return; }
      const extracted = event.data;
      const blob = new Blob([extracted.buffer], { type: "image/webp" });
      const derivedId = createOptimisticImageNode(sourceNode, `${sourceAsset.title} · 抽帧`, blob);
      patchNode(nodeId, { status: "succeeded", error: undefined });
      const controller = new AbortController(); browserOperationControllers.current.add(controller);
      void (async () => {
        const file = new File([blob], `${sourceAsset.title.slice(0, 60) || "video"}-frame.webp`, { type: "image/webp" });
        const uploaded = await uploadFileUntilAccepted(file, "image", () => undefined, { signal: controller.signal });
        const imported = await importCanvasProjectAsset(canvasId, { kind: "upload", uploadId: uploaded.uploadId ?? uploaded.id });
        setAssets((current) => [imported.projectAsset, ...current.filter((asset) => asset.id !== imported.projectAsset.id)]);
        rememberLocalAssetPreview(imported.projectAsset.id, blob);
        ephemeralNodeIds.current.delete(derivedId);
        patchNode(derivedId, { projectAssetId: imported.projectAsset.id, mimeType: imported.projectAsset.contentType, status: imported.projectAsset.status === "ready" ? "succeeded" : "running", error: undefined });
        if (imported.projectAsset.status === "ready") clearLocalPreview(derivedId);
      })().catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        patchNode(derivedId, { status: "failed", error: error instanceof Error ? error.message : "视频抽帧上传失败" });
        setMessage(error instanceof Error ? `抽帧已完成，但保存失败：${error.message}` : "抽帧已完成，但保存失败");
      }).finally(() => browserOperationControllers.current.delete(controller));
    };
    worker.onerror = () => { browserWorkers.current.delete(worker); patchNode(nodeId, { status: "succeeded", error: "视频抽帧线程异常" }); setMessage("视频抽帧线程异常"); worker.terminate(); };
    worker.postMessage({ url: sourceAsset.mediaUrl, timestamp: Math.max(0, (sourceAsset.durationMs ?? 0) / 2000) });
  }, [assets, canvasId, clearLocalPreview, createOptimisticImageNode, flow, patchNode, rememberLocalAssetPreview]);
  extractFrameRef.current = extractFrame;

  const deriveImage = useCallback((nodeId: string, operation: { cropRatio?: number; rotation?: 90 | 180 | 270 }) => {
    const sourceNode = flow.getNode(nodeId);
    const assetId = sourceNode?.data.domain.data.projectAssetId;
    const sourceAsset = assets.find((asset) => asset.id === assetId && asset.kind === "image" && asset.status === "ready");
    if (!sourceNode || !sourceAsset) return setMessage("图片素材尚未准备完成");
    patchNode(nodeId, { status: "running", error: undefined }); setCropNodeId(null);
    const worker = new Worker(new URL("./image-transform.worker.ts", import.meta.url), { type: "module" });
    browserWorkers.current.add(worker);
    worker.onmessage = (event: MessageEvent<{ type: "complete"; buffer: ArrayBuffer; width: number; height: number } | { type: "error"; message: string }>) => {
      browserWorkers.current.delete(worker); worker.terminate();
      if (event.data.type === "error") { patchNode(nodeId, { status: "succeeded", error: event.data.message }); setMessage(event.data.message); return; }
      const transformed = event.data;
      const suffix = operation.rotation ? "rotated" : "cropped";
      const title = `${sourceAsset.title} · ${operation.rotation ? "旋转" : "裁剪"}`;
      const blob = new Blob([transformed.buffer], { type: "image/webp" });
      const derivedId = createOptimisticImageNode(sourceNode, title, blob);
      patchNode(nodeId, { status: "succeeded", error: undefined });
      const controller = new AbortController(); browserOperationControllers.current.add(controller);
      void (async () => {
        const file = new File([blob], `${sourceAsset.title.slice(0, 56) || "image"}-${suffix}.webp`, { type: "image/webp" });
        const uploaded = await uploadFileUntilAccepted(file, "image", () => undefined, { signal: controller.signal });
        const imported = await importCanvasProjectAsset(canvasId, { kind: "upload", uploadId: uploaded.uploadId ?? uploaded.id });
        setAssets((current) => [imported.projectAsset, ...current.filter((asset) => asset.id !== imported.projectAsset.id)]);
        rememberLocalAssetPreview(imported.projectAsset.id, blob);
        ephemeralNodeIds.current.delete(derivedId);
        patchNode(derivedId, { projectAssetId: imported.projectAsset.id, mimeType: imported.projectAsset.contentType, status: imported.projectAsset.status === "ready" ? "succeeded" : "running", error: undefined });
        if (imported.projectAsset.status === "ready") clearLocalPreview(derivedId);
      })().catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        patchNode(derivedId, { status: "failed", error: error instanceof Error ? error.message : "图片保存失败" });
        setMessage(error instanceof Error ? `图片已在本地完成，但保存失败：${error.message}` : "图片已在本地完成，但保存失败");
      }).finally(() => browserOperationControllers.current.delete(controller));
    };
    worker.onerror = () => { browserWorkers.current.delete(worker); patchNode(nodeId, { status: "succeeded", error: "图片处理线程异常" }); setMessage("图片处理线程异常"); worker.terminate(); };
    worker.postMessage({ url: sourceAsset.mediaUrl, ...operation });
  }, [assets, canvasId, clearLocalPreview, createOptimisticImageNode, flow, patchNode, rememberLocalAssetPreview]);
  deriveImageRef.current = deriveImage;

  const uploadAssets = async (files: readonly File[]) => {
    if (!files.length) return;
    if (files.length > 50) { setMessage("单次最多选择 50 个素材，请分批上传"); return; }
    const entries = files.map((file) => ({ id: crypto.randomUUID(), file }));
    setUploading((old) => [...old, ...entries.map(({ id, file }) => ({ id, name: file.name, progress: 0, phase: "uploading" as const }))]);
    const controller = new AbortController();
    uploadBatchControllers.current.add(controller);
    try {
      await runWithConcurrency(entries, 3, async ({ id, file }) => {
        const kind = inferUploadType(file);
        if (!kind) { setUploading((old) => old.map((item) => item.id === id ? { ...item, error: "不支持的文件类型" } : item)); return; }
        try {
          let preparedPreview: Blob | undefined;
          const uploaded = await uploadFileUntilAccepted(file, kind, (progress, phase) => setUploading((old) => old.map((item) => item.id === id ? { ...item, progress, phase: phase === "ready" ? "verifying" : phase } : item)), { signal: controller.signal, onPreparedPreview: kind === "image" ? (blob) => { preparedPreview = blob; } : undefined });
          setUploading((old) => old.map((item) => item.id === id ? { ...item, progress: 100, phase: "saving" } : item));
          const imported = await importCanvasProjectAsset(canvasId, { kind: "upload", uploadId: uploaded.uploadId ?? uploaded.id });
          setAssets((old) => [imported.projectAsset, ...old.filter((item) => item.id !== imported.projectAsset.id)]);
          rememberLocalAssetPreview(imported.projectAsset.id, preparedPreview);
          setUploading((old) => old.filter((item) => item.id !== id));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setUploading((old) => old.map((item) => item.id === id ? { ...item, error: error instanceof Error ? error.message : "上传失败" } : item));
        }
      });
    } finally { uploadBatchControllers.current.delete(controller); }
  };

  const openNodeAssetPicker = useCallback((nodeId: string) => {
    const nodeType = flow.getNode(nodeId)?.data.domain.type;
    if (!nodeType || !["image", "video", "character", "scene"].includes(nodeType)) return;
    setAssetTargetNodeId(nodeId);
    setAssetTab("project");
    setAssetSearch("");
    if (nodeType === "character") setAssetCategory("character");
    else if (nodeType === "scene") setAssetCategory("scene");
    else setAssetCategory("all");
    setAssetPanel(true);
  }, [flow]);

  const uploadIntoNode = useCallback(async (nodeId: string, file: File) => {
    const target = flow.getNode(nodeId);
    if (!target) return;
    const kind = inferUploadType(file);
    if (!kind || !acceptsProjectAsset(target.data.domain.type, kind)) {
      setMessage(target.data.domain.type === "video" ? "视频节点仅支持 MP4 或 MOV" : "该节点仅支持图片素材");
      return;
    }
    showLocalPreview(nodeId, file);
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      selected: true,
      data: { ...node.data, domain: { ...node.data.domain, title: file.name, data: { ...node.data.domain.data, projectAssetId: undefined, mimeType: file.type, status: "running", error: undefined } } },
    } : node));
    setMessage("素材已放入节点，正在后台保存");
    const controller = new AbortController();
    uploadBatchControllers.current.add(controller);
    try {
      let preparedPreview: Blob | undefined;
      const uploaded = await uploadFileUntilAccepted(file, kind, () => undefined, { signal: controller.signal, onPreparedPreview: kind === "image" ? (blob) => { preparedPreview = blob; } : undefined });
      const imported = await importCanvasProjectAsset(canvasId, { kind: "upload", uploadId: uploaded.uploadId ?? uploaded.id });
      setAssets((current) => [imported.projectAsset, ...current.filter((asset) => asset.id !== imported.projectAsset.id)]);
      rememberLocalAssetPreview(imported.projectAsset.id, preparedPreview);
      fillNodeWithAsset(nodeId, imported.projectAsset);
      if (imported.projectAsset.status === "ready") clearLocalPreview(nodeId);
      setMessage(imported.projectAsset.status === "ready" ? "素材已保存，可直接引用" : "素材已上传，正在后台归档");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      clearLocalPreview(nodeId);
      patchNode(nodeId, { projectAssetId: undefined, status: "failed", error: error instanceof Error ? error.message : "素材上传失败" });
      setMessage(error instanceof Error ? error.message : "素材上传失败，请重试");
    } finally {
      uploadBatchControllers.current.delete(controller);
    }
  }, [canvasId, clearLocalPreview, fillNodeWithAsset, flow, patchNode, rememberLocalAssetPreview, setNodes, showLocalPreview]);
  openNodeAssetPickerRef.current = openNodeAssetPicker;
  uploadNodeFileRef.current = (nodeId, file) => { void uploadIntoNode(nodeId, file); };

  const loadGlobalAssets = useCallback(async () => {
    const sequence = ++globalAssetRequest.current;
    const category = assetCategory === "all" ? "" : `&category=${encodeURIComponent(assetCategory)}`;
    try {
      const result = await loadAssetsCacheFirst({
        userId: user.id,
        loadFresh: () => api.get<{ Items: LibraryAsset[] }>(`/api/assets?q=${encodeURIComponent(assetSearch)}&pageSize=100${category}`).then((response) => response.Items),
        selectCached: (assets) => filterCachedAssets(assets, { query: assetSearch, category: assetCategory }).slice(0, 100),
        onCached: (assets) => { if (sequence === globalAssetRequest.current) setGlobalAssets(assets); },
      });
      if (sequence !== globalAssetRequest.current) return;
      setGlobalAssets(result.assets);
    } catch {
      if (sequence === globalAssetRequest.current) setMessage("素材库暂时无法同步，请稍后重试");
    }
  }, [assetCategory, assetSearch, user.id]);
  useEffect(() => { if (assetPanel && assetTab === "global") void loadGlobalAssets(); }, [assetPanel, assetTab, loadGlobalAssets]);

  const importGlobal = async (asset: LibraryAsset) => {
    const result = await importCanvasProjectAsset(canvasId, { kind: "user_asset", assetId: asset.Id });
    setAssets((old) => [result.projectAsset, ...old.filter((item) => item.id !== result.projectAsset.id)]); insertAsset(result.projectAsset);
  };

  const layout = () => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({})); graph.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120 });
    for (const node of nodes) graph.setNode(node.id, { width: node.measured?.width ?? 300, height: node.measured?.height ?? 240 });
    for (const edge of edges) graph.setEdge(edge.source, edge.target);
    try { dagre.layout(graph); setNodes((current) => current.map((node) => { const point = graph.node(node.id); return point ? { ...node, position: { x: point.x - (node.measured?.width ?? 300) / 2, y: point.y - (node.measured?.height ?? 240) / 2 } } : node; })); requestAnimationFrame(() => void flow.fitView({ padding: .18, duration: 500 })); }
    catch { /* cyclic/invalid graph remains untouched */ }
  };

  const composerAnchor = composer ? (() => {
    const node = flow.getInternalNode(composer.nodeId);
    const absolute = node?.internals.positionAbsolute ?? { x: 0, y: 0 };
    const width = Math.min(640, innerWidth - 30);
    const topLeft = flow.flowToScreenPosition(absolute);
    const nodeWidth = (node?.measured.width ?? 300) * viewport.zoom;
    const belowY = topLeft.y + (node?.measured.height ?? 220) * viewport.zoom;
    const top = belowY + 14;
    return { width, left: Math.max(15, Math.min(topLeft.x + (nodeWidth - width) / 2, innerWidth - width - 15)), top, maxHeight: Math.max(120, innerHeight - top - 12) };
  })() : undefined;

  useEffect(() => {
    if (!composer) return;
    const frame = requestAnimationFrame(() => {
      const nodeElement = document.querySelector<HTMLElement>(`[data-node-id="${composer.nodeId}"]`);
      const composerElement = composerRef.current;
      if (!nodeElement || !composerElement) return;
      const internal = flow.getInternalNode(composer.nodeId);
      const stage = nodeElement.closest<HTMLElement>(".react-flow");
      if (!internal || !stage) return;
      const nodeBox = nodeElement.getBoundingClientRect();
      const stageBox = stage.getBoundingClientRect();
      const estimatedComposerHeight = composer.kind === "character_tool" ? 340 : composer.kind === "text" ? 270 : 310;
      const safeNodeTop = stageBox.top + 50;
      const availableNodeHeight = Math.max(120, innerHeight - safeNodeTop - estimatedComposerHeight - 26);
      const current = flow.getViewport();
      const zoom = Math.max(.08, Math.min(current.zoom, current.zoom * availableNodeHeight / Math.max(1, nodeBox.height)));
      const absolute = internal.internals.positionAbsolute;
      const domainWidth = internal.measured.width ?? internal.data.domain.width;
      const currentCenterX = Math.max(stageBox.left + 170, Math.min(nodeBox.left + nodeBox.width / 2, stageBox.right - 170));
      void flow.setViewport({
        x: currentCenterX - stageBox.left - (absolute.x + domainWidth / 2) * zoom,
        y: safeNodeTop - stageBox.top - absolute.y * zoom,
        zoom,
      }, { duration: 260 });
    });
    return () => cancelAnimationFrame(frame);
  }, [composer?.kind, composer?.nodeId, flow]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        setCreateMenu(null); setComposer(null); setAssetPanel(false); setAssetTargetNodeId(null); setInspectAsset(null); setCropNodeId(null); setMontageOpen(false); setHelpOpen(false); setShortcutOpen(false); setProfileOpen(false);
        return;
      }
      if (target?.closest("input,textarea,[contenteditable=true],[role=dialog]") || readOnly) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "a") { event.preventDefault(); setNodes((current) => current.map((node) => ({ ...node, selected: true }))); }
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); restoreHistoryAt(Math.max(0, historyCursor.current + (event.shiftKey ? 1 : -1))); }
      if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); restoreHistoryAt(Math.min(history.current.length - 1, historyCursor.current + 1)); }
      if (mod && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
      if (mod && event.key.toLowerCase() === "v") { event.preventDefault(); duplicateSelection(); }
      if (mod && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelection(null); }
      if (mod && event.key.toLowerCase() === "g") { event.preventDefault(); event.shiftKey ? ungroupSelected() : groupSelected(); }
      if (mod && event.key === "Enter") { const selected = nodes.find((node) => node.selected && node.data.domain.type !== "group"); if (selected) { event.preventDefault(); openComposer(selected.id); } }
      if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); setAssetTargetNodeId(null); setAssetTab("project"); setAssetPanel(true); }
      if (mod && (event.key === "+" || event.key === "=")) { event.preventDefault(); void flow.zoomIn({ duration: 180 }); }
      if (mod && event.key === "-") { event.preventDefault(); void flow.zoomOut({ duration: 180 }); }
      if (event.key === "Delete" || event.key === "Backspace") {
        const selectedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
        if (selectedIds.size) { setNodes((current) => current.filter((node) => !selectedIds.has(node.id) && (!node.parentId || !selectedIds.has(node.parentId)))); setEdges((current) => current.filter((edge) => !edge.selected && !selectedIds.has(edge.source) && !selectedIds.has(edge.target))); }
      }
      if (event.key === "Tab") { event.preventDefault(); setCreateMenu({ screen: { x: innerWidth / 2 - 120, y: innerHeight / 2 - 120 }, position: flow.screenToFlowPosition({ x: innerWidth / 2, y: innerHeight / 2 }), focusOnOpen: true }); }
      if (mod && event.key === "0") { event.preventDefault(); void flow.fitView({ padding: .18, duration: 300 }); }
      if ((event.altKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); layout(); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [edges, flow, nodes, openComposer, readOnly, setEdges, setNodes]);

  if (loadState === "loading") return <div className="canvas-v2-boot"><LoaderCircle className="spin" /> 正在唤醒画布</div>;
  if (loadState === "error") return <div className="canvas-v2-boot canvas-v2-boot--error"><Archive /><b>画布暂时无法载入</b><span>{message}</span><button onClick={() => void load()}><RefreshCw /> 重试</button></div>;

  return <main className="canvas-v2-workspace">
    <header className="canvas-v2-header">
      <div className="canvas-v2-brand-wrap"><button className="canvas-v2-brand" onClick={() => navigate("/studio/canvas")} aria-label="Firefly 画布导航"><span className="canvas-v2-brand__fly"><img src="/firefly-mark.svg" alt="" /></span><b>Firefly</b></button><div className="canvas-v2-brand-menu"><button onClick={() => navigate("/")}><Home /> 回到主页</button><button onClick={() => navigate("/studio/canvas")}><FolderOpen /> 全部项目</button></div></div><i />
      <input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} onBlur={() => { if (projectTitle.trim()) void api.patch(`/api/canvases/${encodeURIComponent(canvasId)}`, { title: projectTitle.trim() }); }} readOnly={readOnly || mobile} aria-label="项目名称" />
      <span className={`canvas-v2-save canvas-v2-save--${saveState}`}>{readOnly || mobile ? <><LockKeyhole /> {mobile ? "移动端只读" : "只读模式"}</> : saveState === "saving" ? <><LoaderCircle className="spin" /> 保存中</> : saveState === "saved" ? <><Check /> 已保存</> : saveState === "offline" ? "离线草稿" : saveState === "conflict" ? "存在编辑冲突" : saveState === "error" ? "保存失败" : "本地草稿"}</span>{readOnly && !mobile && <button className="canvas-v2-takeover" onClick={() => void takeoverLease()}>接管编辑</button>}
      <div className="canvas-v2-account"><button className="canvas-v2-account__avatar" aria-label="打开账号菜单" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{(user.name || user.email).trim().slice(0, 1).toUpperCase()}</span>}</button>{profileOpen && <div className="canvas-v2-account__menu" role="menu"><div><span className="canvas-v2-account__large">{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : (user.name || user.email).trim().slice(0, 1).toUpperCase()}</span><p><b>{user.name}</b><small>{user.email}</small></p></div><i>企业创作空间<small>项目与成片仅你可见</small></i><button onClick={() => navigate("/")}><Home /> 返回首页</button><button onClick={() => { setProfileOpen(false); logout(); }}><LogOut /> 退出登录</button></div>}</div>
    </header>
    <section className="canvas-v2-stage">
      <ReactFlow<CanvasFlowNode, Edge>
        nodes={renderedNodes} edges={renderedEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onNodeDragStart={beginNodeDrag} onNodeDragStop={finishNodeDrag} onMoveStart={() => setCreateMenu(null)}
        onPaneContextMenu={(event) => { event.preventDefault(); if (!readOnly) setCreateMenu({ screen: { x: event.clientX, y: event.clientY }, position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), focusOnOpen: true }); }}
        onPaneClick={() => setCreateMenu(null)} snapToGrid={snapToGrid} snapGrid={[20, 20]} panOnDrag={panMode ? true : [1, 2]} selectionOnDrag={!panMode} nodesDraggable={!readOnly && !mobile}
        minZoom={.08} maxZoom={3} onlyRenderVisibleElements fitView fitViewOptions={CANVAS_INITIAL_FIT_VIEW_OPTIONS} deleteKeyCode={null} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(214,224,220,.14)" />
        {minimapOpen && <MiniMap className="canvas-v2-minimap" pannable zoomable nodeColor={(node) => node.selected ? "#d9e5df" : "#4b5554"} maskColor="rgba(6,8,9,.68)" />}
      </ReactFlow>
      {!nodes.length && <div className="canvas-v2-empty"><span>点击快速新建</span><h1>让片段彼此照亮</h1><div>{creatableTypes.map((type) => { const Icon = typeIcons[type]; return <button key={type} onClick={() => createNode(type)}><Icon /><span>{typeLabels[type]}</span></button>; })}</div></div>}
      <nav className="canvas-v2-pill" aria-label="画布工具">
        <button className={`canvas-v2-pill__add${createMenu && !createMenu.sourceId ? " active" : ""}`} onMouseEnter={(event) => { if (!readOnly) { const box = event.currentTarget.getBoundingClientRect(); window.clearTimeout(rootMenuTimer.current); rootMenuTimer.current = window.setTimeout(() => setCreateMenu({ screen: { x: box.right + 12, y: box.top }, position: flow.screenToFlowPosition({ x: 150, y: innerHeight / 2 }) }), 180); } }} onMouseLeave={() => window.clearTimeout(rootMenuTimer.current)} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); window.clearTimeout(rootMenuTimer.current); setCreateMenu({ screen: { x: box.right + 12, y: box.top }, position: flow.screenToFlowPosition({ x: 150, y: innerHeight / 2 }), focusOnOpen: true }); }} disabled={readOnly}><Plus /></button>
        <button onClick={() => { setCreateMenu(null); setAssetTargetNodeId(null); setAssetTab("project"); setAssetPanel(true); }}><Library /><span>项目资产</span></button>
        <button onClick={() => { setCreateMenu(null); setAssetTargetNodeId(null); setAssetTab("global"); setAssetPanel(true); }}><FolderOpen /><span>资产库</span></button>
        <div className="canvas-v2-help" onMouseEnter={() => setHelpOpen(true)} onMouseLeave={() => setHelpOpen(false)}><button aria-expanded={helpOpen} onClick={() => { setCreateMenu(null); setHelpOpen((open) => !open); }}><CircleHelp /><span>帮助</span></button>{helpOpen && <div className="canvas-v2-help__menu"><button onClick={() => { setShortcutOpen(true); setHelpOpen(false); }}><Keyboard /> 快捷键</button><button onClick={() => navigate("/studio/canvas/tutorial")}><FolderOpen /> 使用教程</button></div>}</div>
      </nav>
      <div className="canvas-v2-toolbar">
        <button onClick={() => restoreHistoryAt(historyCursor.current - 1)} disabled={historyCursor.current <= 0} title="撤销"><Undo2 /></button><button onClick={() => restoreHistoryAt(historyCursor.current + 1)} disabled={historyCursor.current >= history.current.length - 1} title="重做"><Redo2 /></button><i /><button onClick={() => void flow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 350 })} title="重置视角"><RefreshCw /></button><button onClick={() => setEdgesHidden((value) => !value)} className={edgesHidden ? "active" : ""} title="隐藏连线"><Sparkles /></button><button onClick={layout} title="整理画布"><LayoutDashboard /></button><button onClick={() => setMinimapOpen((value) => !value)} className={minimapOpen ? "active" : ""} title="小地图"><MapIcon /></button><button onClick={() => setSnapToGrid((value) => !value)} className={snapToGrid ? "active" : ""} title="网格吸附"><Grid2X2 /></button><button onClick={() => setPanMode((value) => !value)} className={panMode ? "active" : ""} title="移动画布">{panMode ? <Move /> : <MousePointer2 />}</button><i /><CanvasZoomControls />
      </div>
      {selectedNodeCount > 0 && <div className="canvas-v2-selection-tools"><span>{selectedNodeCount} 个节点</span>{selectedNodeCount > 1 && !selectedGroupCount && <button onClick={groupSelected}><GroupIcon /> 成组</button>}{selectedGroupCount > 0 && <button onClick={ungroupSelected}><Ungroup /> 解组</button>}<button onClick={copySelection}><Copy /> 复制</button>{selectedAssets.length > 0 && <button onClick={() => void downloadSelected()}><Download /> 下载</button>}{selectedVideoAssets.length > 0 && <button onClick={() => setMontageOpen(true)}><Scissors /> Montage</button>}</div>}
    </section>

    {draftCandidate && <div className="canvas-v2-notice"><b>发现未同步的本地草稿</b><span>上次编辑可能在刷新或断网前尚未写入服务器。</span><button onClick={() => { hydrate(draftCandidate.document); setRevision(draftCandidate.revision); revisionRef.current = draftCandidate.revision; setDraftCandidate(null); setSaveState("draft"); }}>恢复草稿</button><button onClick={() => { void deleteCanvasDraft(canvasId); setDraftCandidate(null); }}>忽略</button></div>}
    {message && <div className="canvas-v2-toast" role="status">{message}<button onClick={() => setMessage("")} aria-label="关闭提示"><X /></button></div>}
    {createMenu && createMenuStyle && createPortal(<div ref={createMenuRef} className="canvas-v2-create-menu" data-placement={createMenuStyle.placement} style={createMenuStyle} role="menu" aria-label={createMenu.side === "left" ? "添加上下文" : createMenu.side === "right" ? "引用该节点生成" : "添加节点"} onKeyDown={(event) => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return; event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; const current = items.indexOf(document.activeElement as HTMLButtonElement); const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items[index]?.focus(); }}><header>{createMenu.side === "left" ? "添加上下文" : createMenu.side === "right" ? "引用该节点生成" : "添加节点"}</header>{allowedCreateTypes.map((type) => { const Icon = typeIcons[type]; return <button role="menuitem" key={type} onClick={() => createNode(type)}><Icon /><span>{typeLabels[type]}</span><ChevronDown /></button>; })}</div>, document.body)}

    {assetPanel && <aside className="canvas-v2-assets" role="dialog" aria-label="画布资产">
      <header><div><b>{assetTargetNode ? `为「${assetTargetNode.data.domain.title}」选择素材` : assetTab === "project" ? "项目资产" : "全局资产库"}</b><span>{assetTargetNode ? "选择后会填充当前节点，并保存为可持续引用的项目资产" : assetTab === "project" ? "属于这个画布的素材不会随节点删除" : "从你的常用资产中插入并建立项目副本"}</span></div><button aria-label="关闭资产库" onClick={() => { setAssetPanel(false); setAssetTargetNodeId(null); }}><X /></button></header>
      <nav><button className={assetTab === "project" ? "active" : ""} onClick={() => setAssetTab("project")}>项目资产</button><button className={assetTab === "global" ? "active" : ""} onClick={() => setAssetTab("global")}>全局资产库</button></nav>
      {assetTab === "global" && <div className="canvas-v2-assets__categories"><button className={assetCategory === "all" ? "active" : ""} onClick={() => setAssetCategory("all")}>全部</button>{(Object.entries(assetCategoryLabels) as Array<[AssetCategory, string]>).map(([category, label]) => <button key={category} className={assetCategory === category ? "active" : ""} onClick={() => setAssetCategory(category)}>{label}</button>)}</div>}
      <label className="canvas-v2-assets__search"><Search /><input autoFocus value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索素材" /></label>
      {assetTab === "project" && <label className="canvas-v2-assets__upload"><Upload /><b>上传到项目</b><span>支持多选，上传完成后可立即插入</span><input type="file" multiple accept={assetTargetNode?.data.domain.type === "video" ? "video/mp4,video/quicktime" : assetTargetNode ? "image/*" : "image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav"} onChange={(event) => { const selected = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void uploadAssets(selected); }} /></label>}
      <div className="canvas-v2-assets__list">
        {uploading.map((item) => <div className="canvas-v2-assets__progress" key={item.id}><span>{item.name}</span><i><em style={{ width: `${item.progress}%` }} /></i><small>{item.error ?? (item.phase === "preparing" ? "正在检查图片" : item.phase === "verifying" ? "上传完成 · 正在确认" : item.phase === "saving" ? "已上传 · 正在加入项目" : `${item.progress}%`)}</small></div>)}
        {assetTab === "project" ? visibleProjectAssets.map((asset) => <button key={asset.id} onClick={() => insertAsset(asset)} disabled={asset.status === "failed"}><span className="canvas-v2-assets__thumb">{asset.kind === "video" ? <Video /> : asset.kind === "audio" ? <Sparkles /> : <RecoveringThumbnail src={localAssetPreviews[asset.id] ?? asset.thumbnailUrl ?? asset.mediaUrl} alt={asset.title} manualRecovery={false} loading="lazy" decoding="async" />}</span><div><b>{asset.title}</b><small>{asset.kind === "video" ? "视频" : asset.kind === "audio" ? "音频" : "图片"} · {asset.status === "ready" ? "可用" : asset.status === "copying" ? "正在归档" : "不可用"}</small></div><Plus /></button>) : visibleGlobalAssets.map((asset) => <button key={asset.Id} onClick={() => void importGlobal(asset)} disabled={asset.Status !== "Active"}><span className="canvas-v2-assets__thumb">{asset.URL ? <RecoveringThumbnail src={asset.URL} alt={asset.Name || "图片资产"} manualRecovery={false} loading="lazy" decoding="async" /> : <ImageIcon />}</span><div><b>{asset.Name}</b><small>{assetCategoryLabels[asset.Category]} · {asset.Status === "Active" ? "可用" : "处理中"}</small></div><Plus /></button>)}
        {assetTab === "project" && visibleProjectAssets.length === 0 && <div className="canvas-v2-assets__empty"><Library /><b>暂无可用素材</b><span>可直接在节点中本地上传，或先上传到项目资产。</span></div>}
        {assetTab === "global" && visibleGlobalAssets.length === 0 && <div className="canvas-v2-assets__empty"><Library /><b>{assetTargetNode?.data.domain.type === "video" ? "全局资产库暂不包含视频" : "暂无匹配素材"}</b><span>切换到项目资产，或调整分类与搜索条件。</span></div>}
      </div>
    </aside>}

    {shortcutOpen && <div className="canvas-v2-modal" role="dialog" aria-modal="true" aria-labelledby="canvas-shortcuts-title" onClick={() => setShortcutOpen(false)}><section className="canvas-v2-shortcuts" onClick={(event) => event.stopPropagation()}><header><div><span>KEYBOARD MAP</span><h2 id="canvas-shortcuts-title">画布快捷键</h2></div><button onClick={() => setShortcutOpen(false)} aria-label="关闭"><X /></button></header><div>{shortcutGroups.map(([group, items]) => <article key={group}><b>{group}</b><dl>{items.map(([label, keys]) => <div key={label}><dt>{label}</dt><dd>{keys}</dd></div>)}</dl></article>)}</div></section></div>}

    {composer && <div ref={composerRef} className="canvas-v2-node-composer" style={composerAnchor} role="dialog" aria-label="节点生成">
      <div className="canvas-v2-composer">
        <header><span><WandSparkles /></span><div><b>{composer.kind === "text" ? "Polaris 文本助手" : composer.kind === "video" ? "生成视频" : composer.kind === "character_tool" ? "角色专用工具" : "生成图片"}</b><small>已连接的左侧节点会自动成为上下文</small></div><button onClick={() => setComposer(null)} aria-label="关闭"><X /></button></header>
        {composer.kind === "character_tool" && <div className="canvas-v2-character-tools">
          <label>工具<select value={composer.tool} onChange={(event) => setComposer({ ...composer, tool: event.target.value as ComposerState["tool"] })}><option value="turnaround">角色三视图</option><option value="closeup">角色特写</option><option value="expressions">表情九宫格</option><option value="portrait">质感人像</option></select></label>
          <label>人像质感<select value={composer.portraitStyle} onChange={(event) => setComposer({ ...composer, portraitStyle: event.target.value })}>{["自然真实", "清透细腻", "高级哑光", "柔润奶油", "电影颗粒", "纪实粗粝"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>强度<select value={composer.strength} onChange={(event) => setComposer({ ...composer, strength: event.target.value as ComposerState["strength"] })}><option>轻</option><option>标准</option><option>强</option></select></label>
        </div>}
        {composerReferences.length > 0 && <div className="canvas-v2-composer__references" aria-label="当前引用来源"><span>引用自</span><div>{composerReferences.map((reference) => { const Icon = typeIcons[reference.type]; return <span className="canvas-v2-reference-chip" key={reference.sourceId}><button type="button" onClick={() => focusReference(reference.sourceId)} title={`定位到 ${reference.title}`}><Icon /><b>{reference.title}</b></button>{!readOnly && <button type="button" onClick={() => removeReference(reference.sourceId, composer.nodeId)} aria-label={`移除引用 ${reference.title}`}><X /></button>}</span>; })}</div></div>}
        <textarea autoFocus value={composer.prompt} onChange={(event) => setComposer({ ...composer, prompt: event.target.value })} placeholder={composer.kind === "text" ? "说明希望如何改写或扩写…" : "描述希望生成的画面…"} />
        {composer.kind === "text" && <div className="canvas-v2-text-actions" role="radiogroup" aria-label="Polaris 应用方式"><button className={composer.textAction === "replace_selection" ? "active" : ""} disabled={!composer.selectionText} onClick={() => setComposer({ ...composer, textAction: "replace_selection" })}>替换选区</button><button className={composer.textAction === "append" ? "active" : ""} onClick={() => setComposer({ ...composer, textAction: "append" })}>追加</button><button className={composer.textAction === "overwrite" ? "active" : ""} onClick={() => setComposer({ ...composer, textAction: "overwrite" })}>覆盖节点</button></div>}
        {composer.kind !== "text" && <div className="canvas-v2-composer__params">
          <label>模型<select value={composer.model} onChange={(event) => {
            const model = event.target.value;
            if (composer.kind === "video") {
              const spec = videoModels.find((item) => item.id === model);
              setComposer({ ...composer, model, ratio: spec?.ratios.includes(composer.ratio) ? composer.ratio : spec?.ratios[0] ?? composer.ratio, resolution: spec?.resolutions.includes(composer.resolution) ? composer.resolution : spec?.resolutions[0] ?? composer.resolution, duration: Math.max(spec?.duration[0] ?? 4, Math.min(composer.duration, spec?.duration[1] ?? composer.duration)) });
            } else {
              const spec = imageModels.find((item) => item.id === model);
              setComposer({ ...composer, model, resolution: spec?.resolutions.includes(composer.resolution) ? composer.resolution : spec?.defaultResolution ?? composer.resolution });
            }
          }}>{(composer.kind === "video" ? compatibleVideoModels : imageModels).map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
          <label>画幅<select value={composer.ratio} onChange={(event) => setComposer({ ...composer, ratio: event.target.value })}>{(composer.kind === "video" ? activeVideoModel?.ratios ?? [] : imageRatios).map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
          <label>清晰度<select value={composer.resolution} onChange={(event) => setComposer({ ...composer, resolution: event.target.value })}>{(composer.kind === "video" ? activeVideoModel?.resolutions ?? [] : activeImageModel?.resolutions ?? []).map((resolution) => <option key={resolution}>{resolution}</option>)}</select></label>
          {composer.kind === "video" && <label>时长<select value={composer.duration} onChange={(event) => setComposer({ ...composer, duration: Number(event.target.value) })}>{Array.from({ length: (activeVideoModel?.duration[1] ?? 6) - (activeVideoModel?.duration[0] ?? 4) + 1 }, (_, index) => (activeVideoModel?.duration[0] ?? 4) + index).map((duration) => <option value={duration} key={duration}>{duration} 秒</option>)}</select></label>}
        </div>}
        <footer>{composer.kind === "video" && !compatibleVideoModels.length ? <span>当前素材组合超出模型能力</span> : composerReferences.length > 0 && <span>{composerReferences.length} 个引用上下文</span>}<button onClick={() => setComposer(null)}>取消</button><button className="primary" disabled={!composer.prompt.trim() || (composer.kind === "video" && !compatibleVideoModels.length)} onClick={() => void submitComposer()}><WandSparkles /> 开始生成</button></footer>
      </div>
    </div>}
    {inspectAsset && <div className="canvas-v2-modal" role="dialog" aria-modal="true" onClick={() => setInspectAsset(null)}><div className="canvas-v2-inspect" onClick={(event) => event.stopPropagation()}>{inspectAsset.kind === "video" ? <video src={inspectAsset.mediaUrl} controls autoPlay /> : <RecoveringThumbnail src={inspectAsset.mediaUrl} alt={inspectAsset.title} />}<footer><b>{inspectAsset.title}</b><a href={inspectAsset.downloadUrl}><Download /> 下载</a><button onClick={() => setInspectAsset(null)}><X /></button></footer></div></div>}
    {cropNodeId && <div className="canvas-v2-modal" role="dialog" aria-modal="true" aria-label="裁剪图片" onClick={() => setCropNodeId(null)}><div className="canvas-v2-crop" onClick={(event) => event.stopPropagation()}><header><b>选择裁剪画幅</b><span>原图会保留，结果将作为新节点连接在右侧</span></header><div>{[[16 / 9, "16:9"], [4 / 3, "4:3"], [1, "1:1"], [3 / 4, "3:4"], [9 / 16, "9:16"]].map(([ratio, label]) => <button key={label} onClick={() => deriveImage(cropNodeId, { cropRatio: ratio as number })}>{label}</button>)}</div><footer><button onClick={() => setCropNodeId(null)}>取消</button></footer></div></div>}
    {montageOpen && <Suspense fallback={<div className="canvas-v2-modal" role="dialog" aria-modal="true" aria-label="正在载入 Montage"><div className="canvas-v2-crop"><LoaderCircle className="spin" /> 正在载入 Montage</div></div>}><CanvasMontage canvasId={canvasId} initialAssets={selectedVideoAssets} allAssets={assets} onClose={() => setMontageOpen(false)} onComplete={(asset) => {
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      const selected = flow.getNodes().filter((node) => node.selected && node.data.domain.type === "video");
      const x = Math.max(...selected.map((node) => node.position.x + (node.measured?.width ?? node.data.domain.width)), 0) + 150;
      const y = selected[0]?.position.y ?? 0;
      const domain = createCanvasNodeV2("video", { x, y }, { title: "Montage 导出", data: { projectAssetId: asset.id, mimeType: asset.contentType, durationMs: asset.durationMs, status: "succeeded" } });
      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { ...makeFlowNode(domain), selected: true }]);
      setEdges((current) => [...current, ...selected.map((node) => toEdge({ id: `edge-${crypto.randomUUID()}`, source: node.id, target: domain.id, sourceHandle: "right", targetHandle: "left", relation: "context" }))]);
      setMontageOpen(false);
    }} /></Suspense>}
  </main>;
}

export function CanvasV2Workspace(props: { canvasId: string; navigate: (path: string) => void; user: SessionUser; logout: () => void }) {
  return <ReactFlowProvider><Workspace {...props} /></ReactFlowProvider>;
}
