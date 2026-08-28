export interface TextBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextShapeLine {
  text: string;
  start: number;
  end: number;
  y: number;
  left: number;
  right: number;
  width: number;
}

export interface TextLayoutLine extends TextShapeLine {
  index: number;
}

export interface TextLayoutCharacter {
  index: number;
  lineIndex: number;
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rect: [number, number, number, number];
  left: number;
  top: number;
  right: number;
  bottom: number;
  baselineY: number;
}

export interface TextLayoutSnapshot {
  canvasWidth: number;
  canvasHeight: number;
  lineHeightPx: number;
  box?: TextBoxRect;
  contentBounds: TextBoxRect;
  lines: TextLayoutLine[];
  characters: TextLayoutCharacter[];
}
