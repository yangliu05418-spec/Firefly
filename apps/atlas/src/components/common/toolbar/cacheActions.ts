interface CacheClearingWindow extends Window {
  __CLEARING_CACHE__?: boolean;
}

export async function clearAllCacheAndReload(): Promise<void> {
  if (!confirm('This will clear ALL cached data and reload. Continue?')) {
    return;
  }

  (window as CacheClearingWindow).__CLEARING_CACHE__ = true;

  localStorage.clear();
  sessionStorage.clear();

  const dbNames = [
    'webvj-db',
    'webvj-projects',
    'webvj-apikeys',
    'keyval-store',
    'MASterSelectsDB',
    'multicam-settings',
  ];
  for (const name of dbNames) {
    indexedDB.deleteDatabase(name);
  }

  if ('caches' in window) {
    const names = await caches.keys();
    for (const name of names) {
      await caches.delete(name);
    }
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
  }

  setTimeout(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = `${window.location.origin}${window.location.pathname}?cleared=${Date.now()}`;
  }, 100);
}
