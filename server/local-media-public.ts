import crypto from 'node:crypto';
import type { MediaObject } from './db.js';

export type PublicLocalMediaDescriptor = {
  cacheKey: string;
  revision: string;
  variant: 'thumbnail' | 'preview' | 'original';
  mediaType: 'image' | 'video' | 'audio';
  contentType: string;
  size?: number;
  url: string;
  cachePolicy: 'warm' | 'on-demand' | 'pin';
};

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
const mediaType = (contentType: string): PublicLocalMediaDescriptor['mediaType'] =>
  contentType.startsWith('video/') ? 'video' : contentType.startsWith('audio/') ? 'audio' : 'image';

export function publicLocalMedia(
  media: MediaObject,
  input: Pick<PublicLocalMediaDescriptor, 'variant' | 'url' | 'cachePolicy'> & { transform?: string; size?: number },
): PublicLocalMediaDescriptor {
  const transform = input.transform ?? 'identity';
  const revision = digest(`${media.etag}\0${media.size}\0${media.contentType}\0${transform}`);
  return {
    // Content-derived identity allows a byte-identical TOS copy imported into
    // Canvas or Atlas to reuse the same device cache without exposing an ETag.
    cacheKey: digest(`${revision}\0${input.variant}`),
    revision,
    variant: input.variant,
    mediaType: mediaType(media.contentType),
    contentType: input.transform ? 'image/webp' : media.contentType,
    size: input.size ?? (input.transform ? undefined : media.size),
    url: input.url,
    cachePolicy: input.cachePolicy,
  };
}

export function publicLocalMediaFromSource(input: {
  sourceId: string;
  revision: string;
  variant: PublicLocalMediaDescriptor['variant'];
  mediaType: PublicLocalMediaDescriptor['mediaType'];
  contentType: string;
  size?: number;
  url: string;
  cachePolicy: PublicLocalMediaDescriptor['cachePolicy'];
}): PublicLocalMediaDescriptor {
  const revision = digest(input.revision);
  return { ...input, cacheKey: digest(`${revision}\0${input.variant}`), revision };
}
