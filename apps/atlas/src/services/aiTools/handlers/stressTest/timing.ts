export function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForAnimationFrame(): Promise<void> {
  await new Promise<number>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(resolve);
      return;
    }
    window.setTimeout(() => resolve(performance.now()), 16);
  });
}
