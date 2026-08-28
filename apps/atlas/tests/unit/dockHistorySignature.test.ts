import { describe, expect, it } from 'vitest';
import { createDockLayoutHistorySignature } from '../../src/hooks/useGlobalHistory';
import type { DockLayout, DockPanel, DockTabGroup, FloatingPanel } from '../../src/types/dock';

function createPanel(id: string, type: DockPanel['type'] = 'media'): DockPanel {
  return {
    id,
    type,
    title: id,
  };
}

function createTabGroup(activeIndex = 0): DockTabGroup {
  return {
    kind: 'tab-group',
    id: 'main-group',
    activeIndex,
    panels: [
      createPanel('media', 'media'),
      createPanel('properties', 'clip-properties'),
    ],
  };
}

function createLayout(root = createTabGroup()): DockLayout {
  return {
    root,
    floatingPanels: [],
    panelZoom: {},
  };
}

function createFloatingPanel(overrides: Partial<FloatingPanel> = {}): FloatingPanel {
  return {
    id: 'floating-preview',
    panel: createPanel('preview', 'preview'),
    position: { x: 100, y: 80 },
    size: { width: 400, height: 300 },
    zIndex: 1001,
    ...overrides,
  };
}

describe('createDockLayoutHistorySignature', () => {
  it('ignores active tab changes', () => {
    const before = createLayout(createTabGroup(0));
    const after = createLayout(createTabGroup(1));

    expect(createDockLayoutHistorySignature(after))
      .toBe(createDockLayoutHistorySignature(before));
  });

  it('ignores panel data, panel zoom, and floating z-index changes', () => {
    const before = createLayout({
      ...createTabGroup(),
      panels: [
        {
          id: 'preview',
          type: 'preview',
          title: 'Preview',
          data: { source: { type: 'activeComp' }, showTransparencyGrid: false },
        },
      ],
    });
    before.floatingPanels = [createFloatingPanel()];
    before.panelZoom = { preview: 1 };

    const after = createLayout({
      ...createTabGroup(),
      panels: [
        {
          id: 'preview',
          type: 'preview',
          title: 'Preview',
          data: {
            source: { type: 'composition', compositionId: 'comp-1' },
            showTransparencyGrid: true,
          },
        },
      ],
    });
    after.floatingPanels = [createFloatingPanel({ zIndex: 2000 })];
    after.panelZoom = { preview: 1.5 };

    expect(createDockLayoutHistorySignature(after))
      .toBe(createDockLayoutHistorySignature(before));
  });

  it('tracks split ratio changes', () => {
    const before = createLayout({
      kind: 'split',
      id: 'root-split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [
        createTabGroup(),
        {
          kind: 'tab-group',
          id: 'right-group',
          activeIndex: 0,
          panels: [createPanel('export', 'export')],
        },
      ],
    });
    const after = {
      ...before,
      root: {
        ...before.root,
        ratio: 0.7,
      },
    } as DockLayout;

    expect(createDockLayoutHistorySignature(after))
      .not.toBe(createDockLayoutHistorySignature(before));
  });

  it('tracks structural panel and floating-position changes', () => {
    const before = createLayout();
    const afterAddedPanel = createLayout({
      ...createTabGroup(),
      panels: [
        createPanel('media', 'media'),
        createPanel('properties', 'clip-properties'),
        createPanel('export', 'export'),
      ],
    });

    const beforeFloating = createLayout();
    beforeFloating.floatingPanels = [createFloatingPanel()];
    const afterMovedFloating = createLayout();
    afterMovedFloating.floatingPanels = [
      createFloatingPanel({ position: { x: 140, y: 120 } }),
    ];

    expect(createDockLayoutHistorySignature(afterAddedPanel))
      .not.toBe(createDockLayoutHistorySignature(before));
    expect(createDockLayoutHistorySignature(afterMovedFloating))
      .not.toBe(createDockLayoutHistorySignature(beforeFloating));
  });
});
