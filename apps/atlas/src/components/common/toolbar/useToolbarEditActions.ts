import { useCallback } from 'react';

export interface ToolbarEditActions {
  handleCopy: () => void;
  handlePaste: () => void;
  handleOpenSettings: () => void;
}

export function useToolbarEditActions(
  openSettings: () => void,
  closeMenu: () => void,
): ToolbarEditActions {
  const handleCopy = useCallback(() => {
    document.execCommand('copy');
    closeMenu();
  }, [closeMenu]);

  const handlePaste = useCallback(() => {
    document.execCommand('paste');
    closeMenu();
  }, [closeMenu]);

  const handleOpenSettings = useCallback(() => {
    openSettings();
    closeMenu();
  }, [closeMenu, openSettings]);

  return {
    handleCopy,
    handlePaste,
    handleOpenSettings,
  };
}
