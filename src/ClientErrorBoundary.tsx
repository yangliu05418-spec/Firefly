import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFrontendError } from "./client-observability";
import "./client-error-boundary.css";

export class ClientErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { reportFrontendError(error, "react"); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="client-crash" role="alert"><div><span>FIREFLY</span><h1>界面暂时没有完成载入</h1><p>你的任务仍在后台继续，重新载入不会重复提交生成。</p><button onClick={() => location.reload()}>重新载入</button></div></main>;
  }
}
