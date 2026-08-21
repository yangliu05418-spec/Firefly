import { uploadFile, type UploadFileOptions, type UploadKind, type UploadProgressPhase } from "./api";

export const uploadFileUntilAccepted = (
  file: File,
  type: UploadKind,
  onProgress: (value: number, phase: UploadProgressPhase) => void,
  options: Omit<UploadFileOptions, "waitForReady"> = {},
) => uploadFile(file, type, onProgress, { ...options, waitForReady: false });
