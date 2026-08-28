export function measureTextWithLetterSpacing(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  letterSpacing: number,
): number {
  if (text.length === 0) return 0;
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
}

export function splitLongToken(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  token: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const char of token) {
    const candidate = current + char;
    if (current && measureTextWithLetterSpacing(ctx, candidate, letterSpacing) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [token];
}
