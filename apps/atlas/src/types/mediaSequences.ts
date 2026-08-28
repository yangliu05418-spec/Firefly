export type ModelSequencePlaybackMode = 'clamp' | 'loop';

export interface ModelSequenceFrame {
  name: string;
  projectPath?: string;
  sourcePath?: string;
  absolutePath?: string;
  file?: File;
  modelUrl?: string;
}

export interface ModelSequenceData {
  fps: number;
  frameCount: number;
  playbackMode?: ModelSequencePlaybackMode;
  sequenceName?: string;
  frames: ModelSequenceFrame[];
}

export interface GaussianSplatSequenceFrame {
  name: string;
  projectPath?: string;
  sourcePath?: string;
  absolutePath?: string;
  file?: File;
  splatUrl?: string;
  splatCount?: number;
  fileSize?: number;
  container?: string;
  codec?: string;
}

export interface GaussianSplatBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface GaussianSplatSequenceData {
  fps: number;
  frameCount: number;
  playbackMode?: ModelSequencePlaybackMode;
  sequenceName?: string;
  sharedBounds?: GaussianSplatBounds;
  totalSplatCount?: number;
  minSplatCount?: number;
  maxSplatCount?: number;
  totalFileSize?: number;
  container?: string;
  codec?: string;
  frames: GaussianSplatSequenceFrame[];
}
