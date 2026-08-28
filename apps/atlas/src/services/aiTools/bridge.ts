/**
 * AI Tools Bridge - connects browser to Vite dev server via HMR
 * so external agents (Claude CLI) can execute aiTools via HTTP POST.
 *
 * Flow: POST /api/ai-tools -> Vite server -> HMR -> browser -> aiTools.execute() -> HMR -> HTTP response
 *
 * Uses direct import of executeAITool (not window.aiTools) to enforce 'devBridge' caller context.
 */
import { registerDevBridgeBrowserClient } from './devBridge/browser/client';

if (import.meta.hot) {
  registerDevBridgeBrowserClient(import.meta.hot);
}
