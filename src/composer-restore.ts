import type { ComposerDraftState } from "./composer-draft-cache";

export type ComposerRestorePayload = {
  sourceId: string;
  sourceType: "video" | "image";
  sessionId?: string;
  omittedAssets: number;
  state: ComposerDraftState;
};

export type ComposerRestore = ComposerRestorePayload & {
  nonce: number;
  targetSessionId: string;
};
