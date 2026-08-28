import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerPrivateMediaCache } from "./private-media-cache";
import { ClientErrorBoundary } from "./ClientErrorBoundary";
import { installClientErrorCapture } from "./client-observability";
import "./styles.css";
import "./features/assets/archive.css";
import { GenerateEmbedApp } from "./features/atlas-generate/GenerateEmbedApp";

registerPrivateMediaCache();
installClientErrorCapture();

const Root = window.location.pathname.startsWith("/studio/generate-embed") ? GenerateEmbedApp : App;
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ClientErrorBoundary><Root /></ClientErrorBoundary></React.StrictMode>);
