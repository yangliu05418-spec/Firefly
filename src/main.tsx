import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerPrivateMediaCache } from "./private-media-cache";
import "./styles.css";

registerPrivateMediaCache();

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
