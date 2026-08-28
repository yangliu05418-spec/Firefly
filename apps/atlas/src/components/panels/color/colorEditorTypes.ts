import type { CSSProperties } from 'react';

export interface ColorEditorNode {
  id: string;
  type: string;
  name: string;
  enabled?: boolean;
  params: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface ColorEditorEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface ColorEditorVersion {
  id: string;
  name: string;
}

export interface ColorEditorViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface ColorEditorParamDefinition {
  key: string;
  label: string;
  section: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
}

export interface ConnectionDragState {
  fromNodeId: string;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

export type ColorProperty = string;

export type ColorGraphContentStyle = CSSProperties & {
  width: number;
  height: number;
};
