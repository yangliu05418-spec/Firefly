import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MathSceneDefinition, TextClipProperties } from '../../src/types';
import { markDynamicCanvasUpdated } from '../../src/services/canvasVersion';
import { googleFontsService } from '../../src/services/googleFontsService';
import { mathSceneRenderer } from '../../src/services/mathScene/MathSceneRenderer';
import { textRenderer } from '../../src/services/textRenderer';
import {
  createTimelineMathSceneCanvasRuntime,
  createTimelineSolidCanvasRuntime,
  createTimelineTextCanvasRuntime,
  getTimelineGeneratedCanvasRuntime,
  getTimelineGeneratedCanvasRuntimeDimensions,
  renderTimelineMathSceneCanvasRuntime,
  renderTimelineSolidCanvasRuntime,
  renderTimelineTextCanvasRuntime,
} from '../../src/services/timeline/timelineGeneratedCanvasRuntime';

vi.mock('../../src/services/canvasVersion', () => ({
  markDynamicCanvasUpdated: vi.fn(),
}));

vi.mock('../../src/services/mathScene/MathSceneRenderer', () => ({
  mathSceneRenderer: {
    createCanvas: vi.fn((width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }),
    render: vi.fn(),
  },
}));

function makeTextProperties(): TextClipProperties {
  return {
    text: 'Runtime text',
    fontFamily: 'Inter',
    fontSize: 64,
    fontWeight: 400,
    fontStyle: 'normal',
    color: '#ffffff',
    textAlign: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    strokeEnabled: false,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    pathEnabled: false,
    pathPoints: [],
  };
}

function makeMathScene(): MathSceneDefinition {
  return {
    version: 1,
    viewport: {
      xMin: -10,
      xMax: 10,
      yMin: -10,
      yMax: 10,
      showGrid: true,
      showAxes: true,
    },
    style: {
      backgroundColor: '#000000',
      axisColor: '#ffffff',
      gridColor: '#333333',
      labelColor: '#ffffff',
    },
    parameters: [],
    objects: [],
  };
}

describe('timeline generated canvas runtime', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates math scene canvases through the math scene renderer', () => {
    const mathScene = makeMathScene();
    const canvas = createTimelineMathSceneCanvasRuntime({
      mathScene,
      duration: 2,
      dimensions: { width: 1280, height: 720 },
    });

    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(mathSceneRenderer.createCanvas).toHaveBeenCalledWith(1280, 720);
    expect(mathSceneRenderer.render).toHaveBeenCalledWith(mathScene, canvas, 0, 2);
  });

  it('creates text canvases after loading fonts', async () => {
    const { canvas, textProperties } = await createTimelineTextCanvasRuntime({
      textProperties: makeTextProperties(),
      dimensions: { width: 800, height: 450 },
    });

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(450);
    expect(googleFontsService.loadFont).toHaveBeenCalledWith('Inter', 400);
    expect(textRenderer.createCanvas).toHaveBeenCalledWith(800, 450);
    expect(textRenderer.render).toHaveBeenCalledWith(textProperties, canvas);
  });

  it('creates solid canvases and marks them dynamic', () => {
    const canvas = createTimelineSolidCanvasRuntime({
      color: '#ff00aa',
      dimensions: { width: 640, height: 360 },
    });

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(markDynamicCanvasUpdated).toHaveBeenCalledWith(canvas, 'solid');
  });

  it('resolves generated canvas runtime handles and dimensions for store callers', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const clip = {
      source: {
        type: 'text',
        textCanvas: canvas,
      },
    };

    expect(getTimelineGeneratedCanvasRuntime(clip)).toBe(canvas);
    expect(getTimelineGeneratedCanvasRuntimeDimensions(clip, { width: 1920, height: 1080 })).toEqual({
      width: 320,
      height: 180,
    });
    expect(getTimelineGeneratedCanvasRuntimeDimensions({ source: null }, { width: 800, height: 450 })).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('renders text canvas updates through the runtime service', () => {
    const currentCanvas = document.createElement('canvas');
    currentCanvas.width = 800;
    currentCanvas.height = 450;
    const props = makeTextProperties();

    const canvas = renderTimelineTextCanvasRuntime({
      textProperties: props,
      currentCanvas,
      dimensions: { width: 800, height: 450 },
    });

    expect(canvas).toBe(currentCanvas);
    expect(textRenderer.render).toHaveBeenCalledWith(props, currentCanvas);
  });

  it('renders solid canvas updates through the runtime service', () => {
    const currentCanvas = document.createElement('canvas');
    currentCanvas.width = 640;
    currentCanvas.height = 360;

    const canvas = renderTimelineSolidCanvasRuntime({
      color: '#112233',
      currentCanvas,
      dimensions: { width: 640, height: 360 },
    });

    expect(canvas).toBe(currentCanvas);
    expect(markDynamicCanvasUpdated).toHaveBeenCalledWith(currentCanvas, 'solid');
  });

  it('renders math scene canvas updates through the runtime service', () => {
    const mathScene = makeMathScene();
    const currentCanvas = document.createElement('canvas');
    currentCanvas.width = 640;
    currentCanvas.height = 360;

    const canvas = renderTimelineMathSceneCanvasRuntime({
      mathScene,
      currentCanvas,
      localTime: 1.25,
      duration: 5,
      dimensions: { width: 640, height: 360 },
    });

    expect(canvas).toBe(currentCanvas);
    expect(mathSceneRenderer.render).toHaveBeenCalledWith(mathScene, currentCanvas, 1.25, 5);
  });
});
