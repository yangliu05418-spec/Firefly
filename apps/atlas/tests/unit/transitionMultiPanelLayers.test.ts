import { describe, expect, it } from 'vitest';

import { createTransitionMultiPanelLayers } from '../../src/services/layerBuilder/transitionMultiPanelLayers';
import type { Layer } from '../../src/types/layers';
import type { TransitionPrimitive } from '../../src/transitions';

function createBaseLayer(): Layer {
  return {
    id: 'transition:puzzle:incoming',
    name: 'Incoming',
    sourceClipId: 'incoming',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: null,
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

describe('transition multi-panel layers', () => {
  it('creates deterministic source-rect panel layers without mutating the base layer', () => {
    const baseLayer = createBaseLayer();
    const primitive: Extract<TransitionPrimitive, { kind: 'multi-panel' }> = {
      kind: 'multi-panel',
      target: 'incoming',
      rows: 2,
      columns: 2,
      order: 'row-major',
      motion: 'puzzle',
      seed: 0,
      stagger: 0,
    };

    const layers = createTransitionMultiPanelLayers({
      baseLayer,
      primitive,
      progress: 0.5,
      seed: 0,
    });

    expect(baseLayer.sourceRect).toBeUndefined();
    expect(layers).toHaveLength(4);
    expect(layers.map((layer) => layer.id)).toEqual([
      'transition:puzzle:incoming:panel:1:1',
      'transition:puzzle:incoming:panel:1:0',
      'transition:puzzle:incoming:panel:0:1',
      'transition:puzzle:incoming:panel:0:0',
    ]);
    expect(layers.at(-1)?.sourceRect).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
    expect(layers.at(-1)?.scale).toEqual({ x: 0.5, y: 0.5 });
    expect(layers.at(-1)?.opacity).toBeCloseTo(0.5);
    expect(layers.at(-1)?.position.x).toBeCloseTo(-0.72);
    expect(layers.at(-1)?.position.y).toBeCloseTo(-0.5);
  });

  it('uses staggered panel progress to delay later tiles', () => {
    const primitive: Extract<TransitionPrimitive, { kind: 'multi-panel' }> = {
      kind: 'multi-panel',
      target: 'incoming',
      rows: 1,
      columns: 3,
      order: 'row-major',
      motion: 'puzzle',
      stagger: 0.6,
    };

    const layers = createTransitionMultiPanelLayers({
      baseLayer: createBaseLayer(),
      primitive,
      progress: 0.4,
      seed: 0,
    });

    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => layer.id)).toEqual([
      'transition:puzzle:incoming:panel:0:1',
      'transition:puzzle:incoming:panel:0:0',
    ]);
    expect(layers[0]?.opacity).toBeCloseTo(0.142857, 5);
    expect(layers[1]?.opacity).toBeCloseTo(0.4);
  });

  it('pulls magnetic tiles from the center without replacing source rects', () => {
    const primitive: Extract<TransitionPrimitive, { kind: 'multi-panel' }> = {
      kind: 'multi-panel',
      target: 'incoming',
      rows: 2,
      columns: 2,
      order: 'magnetic',
      motion: 'magnetic',
      stagger: 0,
    };

    const layers = createTransitionMultiPanelLayers({
      baseLayer: createBaseLayer(),
      primitive,
      progress: 0.5,
      seed: 0,
    });

    expect(layers).toHaveLength(4);
    const topLeftLayer = layers.find((layer) => layer.sourceRect?.x === 0 && layer.sourceRect.y === 0);

    expect(topLeftLayer?.sourceRect).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
    expect(topLeftLayer?.opacity).toBeCloseTo(0.5);
    expect(topLeftLayer?.position.x).toBeCloseTo(-0.3875);
    expect(topLeftLayer?.position.y).toBeCloseTo(-0.3875);
  });

  it('shatters outgoing panels away from center with fading rotation', () => {
    const primitive: Extract<TransitionPrimitive, { kind: 'multi-panel' }> = {
      kind: 'multi-panel',
      target: 'outgoing',
      rows: 2,
      columns: 2,
      order: 'row-major',
      motion: 'shatter',
      stagger: 0,
    };

    const layers = createTransitionMultiPanelLayers({
      baseLayer: createBaseLayer(),
      primitive,
      progress: 0.5,
      seed: 0,
    });
    const topLeftLayer = layers.find((layer) => layer.sourceRect?.x === 0 && layer.sourceRect.y === 0);
    const rotation = topLeftLayer?.rotation;

    expect(layers).toHaveLength(4);
    expect(topLeftLayer?.opacity).toBeCloseTo(0.5);
    expect(topLeftLayer?.position.x).toBeLessThan(-0.5);
    expect(topLeftLayer?.position.y).toBeLessThan(-0.5);
    expect(typeof rotation === 'number' ? rotation : rotation?.z).toBeCloseTo(0.14);
  });

  it('lets the transition seed drive random panel ordering', () => {
    const primitive: Extract<TransitionPrimitive, { kind: 'multi-panel' }> = {
      kind: 'multi-panel',
      target: 'incoming',
      rows: 2,
      columns: 3,
      order: 'random',
      motion: 'puzzle',
      seed: 0,
      stagger: 0.6,
    };

    const firstSeedLayers = createTransitionMultiPanelLayers({
      baseLayer: createBaseLayer(),
      primitive,
      progress: 0.3,
      seed: 1,
    });
    const secondSeedLayers = createTransitionMultiPanelLayers({
      baseLayer: createBaseLayer(),
      primitive,
      progress: 0.3,
      seed: 2,
    });

    expect(firstSeedLayers.map((layer) => layer.id)).not.toEqual(secondSeedLayers.map((layer) => layer.id));
  });
});
