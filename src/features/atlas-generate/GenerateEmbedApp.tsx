import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { api } from "../../api";
import { AssetCacheScope } from "../../asset-cache-context";
import type { GenerationCapacity, ImageResultBundle, ModelCapability, SessionUser, Task } from "../../types";
import { Composer } from "../composer/Composer";
import "./generate-embed.css";

const channel = "firefly.atlas.generate.v1";
type Destination = { id: string; sourceType: "image" | "video"; sourceId: string; status: string; atlasAssetId?: string; errorCode?: string };

const send = (projectId: string, type: string, payload?: unknown) => {
  if (window.parent === window) return;
  window.parent.postMessage({ channel, type, projectId, payload }, window.location.origin);
};

export function GenerateEmbedApp() {
  const projectId = useMemo(() => new URLSearchParams(window.location.search).get("projectId")?.trim() ?? "", []);
  const [user, setUser] = useState<SessionUser>();
  const [sessionId, setSessionId] = useState("");
  const [models, setModels] = useState<ModelCapability[]>([]);
  const [capacity, setCapacity] = useState<GenerationCapacity | null>(null);
  const [error, setError] = useState("");
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [retryingDestinationId, setRetryingDestinationId] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const destinationState = useRef(new Map<string, string>());

  useEffect(() => {
    if (!projectId) return;
    const abort = new AbortController();
    void Promise.all([
      api.get<{ authenticated: boolean; user?: SessionUser }>("/api/auth/session", { timeoutMs: 8000 }),
      api.get<ModelCapability[]>("/api/models", { timeoutMs: 8000 }),
      api.get<GenerationCapacity>("/api/generation-capacity", { timeoutMs: 8000 }),
      api.post<{ sessionId: string }>(`/api/atlas/projects/${encodeURIComponent(projectId)}/generation-session`, {}, { timeoutMs: 8000 }),
    ]).then(([auth, availableModels, generationCapacity, session]) => {
      if (abort.signal.aborted) return;
      if (!auth.authenticated || !auth.user) throw new Error("请先使用企业飞书账号登录");
      setUser(auth.user); setModels(availableModels); setCapacity(generationCapacity); setSessionId(session.sessionId);
      send(projectId, "READY", { sessionId: session.sessionId });
    }).catch((failure) => {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "生成面板暂时无法载入");
    });
    return () => abort.abort();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !sessionId) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await api.get<{ items: Destination[] }>(`/api/atlas/projects/${encodeURIComponent(projectId)}/generation-destinations`, { timeoutMs: 8000 });
        if (active) setDestinations(response.items);
        for (const item of response.items) {
          const fingerprint = `${item.status}:${item.atlasAssetId ?? ""}:${item.errorCode ?? ""}`;
          if (destinationState.current.get(item.id) === fingerprint) continue;
          destinationState.current.set(item.id, fingerprint);
          send(projectId, "TASK_STATUS", item);
          if (item.status === "ready") send(projectId, "OUTPUT_READY", item);
          if (item.status === "failed") send(projectId, "IMPORT_FAILED", item);
        }
      } catch { /* durable destinations remain recoverable; next poll retries */ }
    };
    void poll();
    const timer = window.setInterval(() => { if (active && document.visibilityState === "visible") void poll(); }, 2000);
    const resume = () => void poll();
    window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [projectId, sessionId]);

  if (!projectId) return <div className="atlas-generate-state" role="alert">缺少 Atlas 项目标识</div>;
  if (error) return <div className="atlas-generate-state" role="alert"><b>生成面板未能打开</b><span>{error}</span></div>;
  if (!user || !sessionId || !models.length) return <div className="atlas-generate-state"><LoaderCircle className="spin" /> 正在连接 Firefly 生成能力</div>;

  const admitted = (sourceType: "image" | "video", sourceId: string) => send(projectId, "TASK_ADMITTED", { sourceType, sourceId });
  const failedDestinations = destinations.filter((item) => item.status === "failed");
  const pendingDestinations = destinations.filter((item) => item.status === "pending" || item.status === "copying");
  const retryDestination = async (destinationId: string) => {
    if (retryingDestinationId) return;
    setRetryingDestinationId(destinationId);
    setDeliveryError("");
    try {
      await api.post(`/api/atlas/projects/${encodeURIComponent(projectId)}/generation-destinations/${encodeURIComponent(destinationId)}/retry`, {}, { timeoutMs: 8000 });
      setDestinations((items) => items.map((item) => item.id === destinationId ? { ...item, status: "pending", errorCode: undefined } : item));
    } catch (failure) {
      setDeliveryError(failure instanceof Error ? failure.message : "重新加入素材库失败，请稍后重试");
    } finally { setRetryingDestinationId(""); }
  };
  return <AssetCacheScope userId={user.id}><main className="atlas-generate-embed">
    <header><div><small>FIREFLY × ATLAS</small><b>生成素材</b></div><button type="button" aria-label="关闭生成面板" onClick={() => send(projectId, "CLOSE")}><X /></button></header>
    <div className="atlas-generate-composer"><Composer
      models={models} compact={false} sessionId={sessionId} destination={{ kind: "atlas_project", projectId }}
      generationCapacity={capacity} onGenerationSettled={() => void api.get<GenerationCapacity>("/api/generation-capacity").then(setCapacity).catch(() => undefined)}
      onCreated={(task: Task) => admitted("video", task.id)}
      onImagesGenerated={(bundle: ImageResultBundle) => admitted("image", bundle.id)}
    /></div>
    {(pendingDestinations.length > 0 || failedDestinations.length > 0) && <aside className="atlas-generate-deliveries" aria-live="polite">
      {pendingDestinations.length > 0 && <div className="atlas-generate-delivery is-pending"><LoaderCircle className="spin" /><span>{pendingDestinations.length} 个生成结果正在加入当前项目素材库</span></div>}
      {failedDestinations.map((item) => <div className="atlas-generate-delivery is-failed" key={item.id}>
        <span>结果已生成，但暂未加入素材库。重试不会重新生成或产生费用。</span>
        <button type="button" disabled={Boolean(retryingDestinationId)} onClick={() => void retryDestination(item.id)}>{retryingDestinationId === item.id ? "重试中…" : "重试加入素材库"}</button>
      </div>)}
      {deliveryError && <div className="atlas-generate-delivery is-failed" role="alert">{deliveryError}</div>}
    </aside>}
    <footer>生成任务会在后台继续，结果就绪后自动进入当前项目素材库。</footer>
  </main></AssetCacheScope>;
}
