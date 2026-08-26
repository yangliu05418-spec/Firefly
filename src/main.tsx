import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerPrivateMediaCache } from "./private-media-cache";
import { ClientErrorBoundary } from "./ClientErrorBoundary";
import { installClientErrorCapture } from "./client-observability";
import "./styles.css";
import "./features/assets/archive.css";

registerPrivateMediaCache();
installClientErrorCapture();

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ClientErrorBoundary><App /></ClientErrorBoundary></React.StrictMode>);
