import type { EasingType } from './animationProperties';

// Math Scene clip support
export interface MathSceneViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  showGrid: boolean;
  showAxes: boolean;
}

export interface MathSceneStyle {
  backgroundColor: string;
  axisColor: string;
  gridColor: string;
  labelColor: string;
}

export interface MathParameterAnimation {
  enabled: boolean;
  from: number;
  to: number;
  startTime: number;
  endTime: number;
  easing: EasingType;
}

export interface MathParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  animation?: MathParameterAnimation;
}

export interface MathObjectAnimation {
  reveal?: {
    enabled: boolean;
    startTime: number;
    endTime: number;
  };
}

export interface MathBaseObject {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  animation?: MathObjectAnimation;
}

export interface MathFunctionObject extends MathBaseObject {
  type: 'function';
  expression: string;
  domain?: [number, number];
  samples: number;
  stroke: string;
  strokeWidth: number;
}

export interface MathPointObject extends MathBaseObject {
  type: 'point';
  xExpression: string;
  yExpression: string;
  radius: number;
  fill: string;
  stroke: string;
  labelVisible: boolean;
}

export interface MathTangentObject extends MathBaseObject {
  type: 'tangent';
  functionId: string;
  atExpression: string;
  length: number;
  stroke: string;
  strokeWidth: number;
}

export interface MathLabelObject extends MathBaseObject {
  type: 'label';
  text: string;
  xExpression: string;
  yExpression: string;
  fontSize: number;
  color: string;
}

export type MathObject =
  | MathFunctionObject
  | MathPointObject
  | MathTangentObject
  | MathLabelObject;

export interface MathSceneDefinition {
  version: 1;
  viewport: MathSceneViewport;
  style: MathSceneStyle;
  parameters: MathParameter[];
  objects: MathObject[];
}
