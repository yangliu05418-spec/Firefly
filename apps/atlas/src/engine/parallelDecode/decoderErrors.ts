export function isDecoderResetAbort(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('Aborted due to reset');
  }
  const message = String(error);
  return message.includes('AbortError') || message.includes('Aborted due to reset');
}
