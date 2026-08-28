export const HISTORY_DEBUG_DISABLE_STORAGE_KEY = 'masterselects.debug.disableHistory';

type HistoryDebugWindow = Window & {
  __MS_DISABLE_HISTORY__?: boolean;
  __MS_HISTORY_DEBUG__?: {
    disable: () => void;
    enable: () => void;
    isDisabled: () => boolean;
    storageKey: string;
  };
};

function readHistoryDebugStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage?.getItem(HISTORY_DEBUG_DISABLE_STORAGE_KEY);
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
}

export function isHistoryDisabledForDebug(): boolean {
  if (typeof window === 'undefined') return false;
  const debugWindow = window as HistoryDebugWindow;
  return debugWindow.__MS_DISABLE_HISTORY__ === true || readHistoryDebugStorage();
}

export function setHistoryDisabledForDebug(disabled: boolean): void {
  if (typeof window === 'undefined') return;
  const debugWindow = window as HistoryDebugWindow;
  debugWindow.__MS_DISABLE_HISTORY__ = disabled;
  try {
    if (disabled) {
      window.localStorage?.setItem(HISTORY_DEBUG_DISABLE_STORAGE_KEY, '1');
    } else {
      window.localStorage?.removeItem(HISTORY_DEBUG_DISABLE_STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
}

function installHistoryDebugControls(): void {
  if (typeof window === 'undefined') return;
  const debugWindow = window as HistoryDebugWindow;
  debugWindow.__MS_HISTORY_DEBUG__ = {
    disable: () => setHistoryDisabledForDebug(true),
    enable: () => setHistoryDisabledForDebug(false),
    isDisabled: isHistoryDisabledForDebug,
    storageKey: HISTORY_DEBUG_DISABLE_STORAGE_KEY,
  };
}

installHistoryDebugControls();
