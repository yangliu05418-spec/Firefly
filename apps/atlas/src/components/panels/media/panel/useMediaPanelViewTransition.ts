import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { MediaPanelViewMode } from './types';

const MEDIA_PANEL_VIEW_TRANSITION_MS = 500;

interface MediaPanelTransitionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MediaPanelTransitionCapture {
  box: MediaPanelTransitionBox;
  clone: HTMLElement;
  baseWidth: number;
  baseHeight: number;
  scaleX: number;
  scaleY: number;
}

interface PendingMediaPanelViewTransition {
  captures: Map<string, MediaPanelTransitionCapture>;
  overlay: HTMLDivElement;
  panelBox: MediaPanelTransitionBox;
}

interface ActiveMediaPanelViewTransition {
  animations: Animation[];
  hiddenTargets: HTMLElement[];
  overlay: HTMLDivElement;
  timeoutId: number;
}

interface UseMediaPanelViewTransitionInput {
  mediaPanelContentRef: { current: HTMLDivElement | null };
  viewMode: MediaPanelViewMode;
  setViewMode: Dispatch<SetStateAction<MediaPanelViewMode>>;
  setGridFolderId: Dispatch<SetStateAction<string | null>>;
}

function rectToTransitionBox(rect: DOMRect): MediaPanelTransitionBox {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function boxesIntersect(a: MediaPanelTransitionBox, b: MediaPanelTransitionBox): boolean {
  return (
    a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function useMediaPanelViewTransition({
  mediaPanelContentRef,
  viewMode,
  setViewMode,
  setGridFolderId,
}: UseMediaPanelViewTransitionInput) {
  const pendingViewTransitionRef = useRef<PendingMediaPanelViewTransition | null>(null);
  const activeViewTransitionRef = useRef<ActiveMediaPanelViewTransition | null>(null);

  const cleanupActiveMediaPanelViewTransition = useCallback(() => {
    const active = activeViewTransitionRef.current;
    if (!active) return;

    activeViewTransitionRef.current = null;
    window.clearTimeout(active.timeoutId);
    active.animations.forEach((animation) => animation.cancel());
    active.hiddenTargets.forEach((target) => {
      target.classList.remove('media-panel-view-transition-hidden');
    });
    active.overlay.remove();
  }, []);

  const cleanupPendingMediaPanelViewTransition = useCallback(() => {
    const pending = pendingViewTransitionRef.current;
    if (!pending) return;

    pendingViewTransitionRef.current = null;
    pending.overlay.remove();
  }, []);

  const prepareMediaPanelViewTransition = useCallback(() => {
    cleanupActiveMediaPanelViewTransition();
    cleanupPendingMediaPanelViewTransition();

    if (prefersReducedMotion()) return;

    const content = mediaPanelContentRef.current;
    if (!content) return;

    const panelBox = rectToTransitionBox(content.getBoundingClientRect());
    if (panelBox.width < 1 || panelBox.height < 1) return;

    const overlay = document.createElement('div');
    overlay.className = 'media-panel-view-transition-layer';
    overlay.style.left = `${panelBox.left}px`;
    overlay.style.top = `${panelBox.top}px`;
    overlay.style.width = `${panelBox.width}px`;
    overlay.style.height = `${panelBox.height}px`;

    const captures = new Map<string, MediaPanelTransitionCapture>();
    const nodes = content.querySelectorAll<HTMLElement>('[data-media-panel-anim-id]');
    nodes.forEach((node) => {
      const id = node.dataset.mediaPanelAnimId;
      if (!id || node.matches(':focus-within')) return;

      const box = rectToTransitionBox(node.getBoundingClientRect());
      if (box.width < 1 || box.height < 1 || !boxesIntersect(box, panelBox)) return;

      const clone = node.cloneNode(true) as HTMLElement;
      const baseWidth = node.offsetWidth || box.width;
      const baseHeight = node.offsetHeight || box.height;
      const scaleX = box.width / Math.max(baseWidth, 1);
      const scaleY = box.height / Math.max(baseHeight, 1);
      clone.classList.add('media-panel-view-transition-clone');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('draggable', 'false');
      clone.querySelectorAll<HTMLElement>('[draggable]').forEach((draggableChild) => {
        draggableChild.setAttribute('draggable', 'false');
      });
      clone.style.left = `${box.left - panelBox.left}px`;
      clone.style.top = `${box.top - panelBox.top}px`;
      clone.style.width = `${baseWidth}px`;
      clone.style.height = `${baseHeight}px`;
      clone.style.transform = `scale(${scaleX}, ${scaleY})`;

      captures.set(id, { box, clone, baseWidth, baseHeight, scaleX, scaleY });
      overlay.appendChild(clone);
    });

    if (captures.size === 0) {
      overlay.remove();
      return;
    }

    document.body.appendChild(overlay);
    pendingViewTransitionRef.current = { captures, overlay, panelBox };
  }, [cleanupActiveMediaPanelViewTransition, cleanupPendingMediaPanelViewTransition, mediaPanelContentRef]);

  useLayoutEffect(() => {
    const pending = pendingViewTransitionRef.current;
    if (!pending) return;

    pendingViewTransitionRef.current = null;

    const content = mediaPanelContentRef.current;
    if (!content || prefersReducedMotion()) {
      pending.overlay.remove();
      return;
    }

    const nextPanelBox = rectToTransitionBox(content.getBoundingClientRect());
    const hiddenTargets: HTMLElement[] = [];
    const animations: Animation[] = [];

    const animateCloneOut = ({ clone, scaleX, scaleY }: MediaPanelTransitionCapture) => {
      animations.push(clone.animate(
        [
          { opacity: 1, transform: `scale(${scaleX}, ${scaleY}) translate3d(0, 0, 0)` },
          { opacity: 0, transform: `scale(${scaleX}, ${scaleY}) translate3d(0, -4px, 0)` },
        ],
        {
          duration: 180,
          easing: 'ease-out',
          fill: 'forwards',
        }
      ));
    };

    pending.captures.forEach((capture, id) => {
      const { box, clone, baseWidth, baseHeight, scaleX, scaleY } = capture;
      const target = content.querySelector<HTMLElement>(`[data-media-panel-anim-id="${CSS.escape(id)}"]`);
      if (!target) {
        animateCloneOut(capture);
        return;
      }

      const targetBox = rectToTransitionBox(target.getBoundingClientRect());
      if (targetBox.width < 1 || targetBox.height < 1 || !boxesIntersect(targetBox, nextPanelBox)) {
        animateCloneOut(capture);
        return;
      }

      const sourceLeft = box.left - pending.panelBox.left;
      const sourceTop = box.top - pending.panelBox.top;
      const targetLeft = targetBox.left - pending.panelBox.left;
      const targetTop = targetBox.top - pending.panelBox.top;
      const targetBaseWidth = target.offsetWidth || targetBox.width;
      const targetBaseHeight = target.offsetHeight || targetBox.height;
      const targetScaleX = targetBox.width / Math.max(targetBaseWidth, 1);
      const targetScaleY = targetBox.height / Math.max(targetBaseHeight, 1);
      const targetInitialWidth = box.width / Math.max(targetScaleX, 0.001);
      const targetInitialHeight = box.height / Math.max(targetScaleY, 0.001);
      const targetScaleTransform = `scale(${targetScaleX}, ${targetScaleY})`;

      const targetClone = target.cloneNode(true) as HTMLElement;
      targetClone.classList.add('media-panel-view-transition-clone', 'media-panel-view-transition-target-clone');
      targetClone.setAttribute('aria-hidden', 'true');
      targetClone.setAttribute('draggable', 'false');
      targetClone.querySelectorAll<HTMLElement>('[draggable]').forEach((draggableChild) => {
        draggableChild.setAttribute('draggable', 'false');
      });
      targetClone.style.left = `${sourceLeft}px`;
      targetClone.style.top = `${sourceTop}px`;
      targetClone.style.width = `${targetInitialWidth}px`;
      targetClone.style.height = `${targetInitialHeight}px`;
      targetClone.style.opacity = '0';
      targetClone.style.transform = targetScaleTransform;
      pending.overlay.appendChild(targetClone);

      target.classList.add('media-panel-view-transition-hidden');
      hiddenTargets.push(target);

      animations.push(clone.animate(
        [
          {
            left: `${sourceLeft}px`,
            top: `${sourceTop}px`,
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            transform: `scale(${scaleX}, ${scaleY})`,
            opacity: 1,
          },
          {
            left: `${targetLeft}px`,
            top: `${targetTop}px`,
            width: `${targetBaseWidth}px`,
            height: `${targetBaseHeight}px`,
            transform: targetScaleTransform,
            opacity: 0,
          },
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
        }
      ));
      animations.push(targetClone.animate(
        [
          {
            left: `${sourceLeft}px`,
            top: `${sourceTop}px`,
            width: `${targetInitialWidth}px`,
            height: `${targetInitialHeight}px`,
            transform: targetScaleTransform,
            opacity: 0,
            offset: 0,
          },
          {
            left: `${sourceLeft + ((targetLeft - sourceLeft) * 0.35)}px`,
            top: `${sourceTop + ((targetTop - sourceTop) * 0.35)}px`,
            width: `${targetInitialWidth + ((targetBaseWidth - targetInitialWidth) * 0.35)}px`,
            height: `${targetInitialHeight + ((targetBaseHeight - targetInitialHeight) * 0.35)}px`,
            transform: targetScaleTransform,
            opacity: 0,
            offset: 0.18,
          },
          {
            left: `${targetLeft}px`,
            top: `${targetTop}px`,
            width: `${targetBaseWidth}px`,
            height: `${targetBaseHeight}px`,
            transform: targetScaleTransform,
            opacity: 1,
            offset: 1,
          },
        ],
        {
          duration: MEDIA_PANEL_VIEW_TRANSITION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        }
      ));
    });

    content.querySelectorAll<HTMLElement>('[data-media-panel-anim-id]').forEach((target) => {
      const id = target.dataset.mediaPanelAnimId;
      if (!id || pending.captures.has(id)) return;

      const targetBox = rectToTransitionBox(target.getBoundingClientRect());
      if (targetBox.width < 1 || targetBox.height < 1 || !boxesIntersect(targetBox, nextPanelBox)) return;

      animations.push(target.animate(
        [
          { opacity: 0 },
          { opacity: 1 },
        ],
        {
          duration: 180,
          delay: 160,
          easing: 'ease-out',
        }
      ));
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;

      const active = activeViewTransitionRef.current;
      if (active?.overlay === pending.overlay) {
        activeViewTransitionRef.current = null;
      }
      window.clearTimeout(timeoutId);
      hiddenTargets.forEach((target) => {
        target.classList.remove('media-panel-view-transition-hidden');
      });
      pending.overlay.remove();
    };

    const timeoutId = window.setTimeout(finish, MEDIA_PANEL_VIEW_TRANSITION_MS + 100);
    activeViewTransitionRef.current = {
      animations,
      hiddenTargets,
      overlay: pending.overlay,
      timeoutId,
    };

    if (animations.length === 0) {
      finish();
      return;
    }

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
  });

  useEffect(() => () => {
    cleanupActiveMediaPanelViewTransition();
    cleanupPendingMediaPanelViewTransition();
  }, [cleanupActiveMediaPanelViewTransition, cleanupPendingMediaPanelViewTransition]);

  return useCallback((nextViewMode: MediaPanelViewMode) => {
    if (nextViewMode === viewMode) return;

    prepareMediaPanelViewTransition();
    setViewMode(nextViewMode);
    if (nextViewMode !== 'icons') {
      setGridFolderId(null);
    }
  }, [prepareMediaPanelViewTransition, setGridFolderId, setViewMode, viewMode]);
}
