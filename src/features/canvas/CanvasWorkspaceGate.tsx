import { lazy, Suspense, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { canvasV2Config } from "./canvas-api";
import { CanvasWorkspace as LegacyCanvasWorkspace } from "./CanvasWorkspace";
import { CanvasTutorial } from "./v2/CanvasTutorial";
import type { SessionUser } from "../../types";
const CanvasV2Workspace = lazy(() => import("./v2/CanvasV2Workspace").then((module) => ({ default: module.CanvasV2Workspace })));

export function CanvasWorkspaceGate(props: { canvasId: string; navigate: (path: string) => void; user: SessionUser; logout: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    canvasV2Config().then((value) => { if (active) setEnabled(value.enabled); }).catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);
  if (props.canvasId === "tutorial") return <CanvasTutorial navigate={props.navigate} />;
  if (enabled === null) return <div className="canvas-v2-boot"><LoaderCircle className="spin" /> 正在准备画布</div>;
  return enabled ? <Suspense fallback={<div className="canvas-v2-boot"><LoaderCircle className="spin" /> 正在载入画布内核</div>}><CanvasV2Workspace {...props} /></Suspense> : <LegacyCanvasWorkspace canvasId={props.canvasId} navigate={props.navigate} />;
}
