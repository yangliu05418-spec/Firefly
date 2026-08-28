import type { MessageKey } from './keys';
import { translate } from './index';

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';

/** Localize upstream UI without changing persisted IDs or the upstream build. */
export function originalUi(key: MessageKey, upstreamFallback: string): string {
  return IS_FIREFLY_VARIANT ? translate('zh-CN', key) : upstreamFallback;
}
