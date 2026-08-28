import { measureTextWithLetterSpacing, splitLongToken } from './textMeasurement';

export function wrapTextToLines(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  const safeMaxWidth = Math.max(1, maxWidth);
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }

    const words = paragraph.trim().split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;

      if (measureTextWithLetterSpacing(ctx, candidate, letterSpacing) <= safeMaxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }

      if (measureTextWithLetterSpacing(ctx, word, letterSpacing) <= safeMaxWidth) {
        current = word;
        continue;
      }

      const chunks = splitLongToken(ctx, word, safeMaxWidth, letterSpacing);
      lines.push(...chunks.slice(0, -1));
      current = chunks[chunks.length - 1] ?? '';
    }

    if (current || words.length === 0) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [''];
}
