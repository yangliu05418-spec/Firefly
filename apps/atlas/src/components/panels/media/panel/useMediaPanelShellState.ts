import { useEffect, useState, type RefObject } from 'react';
import { useMediaPanelViewTransition } from './useMediaPanelViewTransition';
import type { MediaPanelViewMode } from './types';

const VIEW_MODE_STORAGE_KEY = 'media-panel-view-mode';

export function loadMediaPanelViewMode(): MediaPanelViewMode {
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  if (stored === 'board') return 'board';
  if (stored === 'icons' || stored === 'grid') return 'icons';
  return 'classic';
}

interface UseMediaPanelShellStateInput {
  mediaPanelContentRef: RefObject<HTMLDivElement | null>;
}

export function useMediaPanelShellState({
  mediaPanelContentRef,
}: UseMediaPanelShellStateInput) {
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [viewMode, setViewMode] = useState<MediaPanelViewMode>(loadMediaPanelViewMode);
  const [isGenerativeTrayExpanded, setGenerativeTrayExpanded] = useState(false);
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [gridFolderId, setGridFolderId] = useState<string | null>(null);

  const handleViewModeChange = useMediaPanelViewTransition({
    mediaPanelContentRef,
    viewMode,
    setViewMode,
    setGridFolderId,
  });

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!addDropdownOpen) return;
    const handleClickOutside = () => setAddDropdownOpen(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [addDropdownOpen]);

  return {
    addDropdownOpen,
    setAddDropdownOpen,
    viewMode,
    setViewMode,
    handleViewModeChange,
    isGenerativeTrayExpanded,
    setGenerativeTrayExpanded,
    mediaSearchQuery,
    setMediaSearchQuery,
    gridFolderId,
    setGridFolderId,
  };
}
