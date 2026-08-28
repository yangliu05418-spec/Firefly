// Firefly intentionally excludes Atlas's retired local-analysis runtimes from
// its production build. Kept as a real Worker entry so an old project cannot
// crash the editor if it still reaches one of those legacy call sites.
self.addEventListener('message', () => {
  self.postMessage({
    type: 'error',
    error: '此本地分析功能未在 Firefly Atlas 中开放',
  });
});

export {};
