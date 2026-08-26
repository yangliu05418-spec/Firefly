import { useEffect, useRef, type MutableRefObject } from "react";
import { LoaderCircle } from "lucide-react";
import type { Task } from "../../types";
import { RecoveringImage, type ImageRecoveryState } from "../../recovering-image";
import { reportClientJourney } from "../../client-observability";

function PosterRecovery({ phase, taskId, startedAt, reported }: ImageRecoveryState & { taskId: string; startedAt: number; reported: MutableRefObject<boolean> }) {
  useEffect(() => {
    if (phase !== "failed" || reported.current) return;
    reported.current = true;
    reportClientJourney({ journey: "poster_load", outcome: "failure", taskId, elapsedMs: Date.now() - startedAt, errorCode: "POSTER_LOAD_FAILED" });
  }, [phase, reported, startedAt, taskId]);
  return <span className={`archive-card__poster-state archive-card__poster-state--${phase}`} role="status"><LoaderCircle className={phase === "retrying" ? "spin" : ""} /><span>{phase === "retrying" ? "正在恢复海报" : "海报暂时不可用"}</span></span>;
}

export function ArchivePoster({ task }: { task: Task }) {
  const startedAt = useRef(Date.now());
  const reported = useRef(false);
  const ready = Boolean(task.posterUrl) && (task.posterStatus === "ready" || task.posterStatus === undefined);
  if (!ready || !task.posterUrl) {
    return task.posterStatus === "processing" ? <span className="archive-card__poster-state" role="status"><LoaderCircle className="spin" /><span>海报生成中</span></span> : null;
  }
  return <RecoveringImage
    key={`${task.id}-${task.mediaRevision ?? 0}`}
    className="archive-card__poster"
    src={task.posterUrl}
    alt=""
    loading="lazy"
    decoding="async"
    onLoad={() => {
      if (reported.current) return;
      reported.current = true;
      reportClientJourney({ journey: "poster_load", outcome: "success", taskId: task.id, elapsedMs: Date.now() - startedAt.current });
    }}
    fallback={(state) => <PosterRecovery {...state} taskId={task.id} startedAt={startedAt.current} reported={reported} />}
  />;
}
