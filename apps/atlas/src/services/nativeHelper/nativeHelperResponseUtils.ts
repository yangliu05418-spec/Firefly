import type { OkResponse, Response } from './protocol';

export function getErrorMessage(response: Response, fallback: string): string {
  return response.ok === false ? response.error.message : fallback;
}

export function okField<T>(response: Response, key: string): T | undefined {
  return response.ok === true ? (response as OkResponse)[key] as T | undefined : undefined;
}
