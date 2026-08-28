import type { Layer } from './layers';

export interface Project {
  id: string;
  name: string;
  layers: Layer[];
  outputResolution: { width: number; height: number };
  fps: number;
}

export interface MIDIMapping {
  channel: number;
  control: number;
  target: string;
  min: number;
  max: number;
}
