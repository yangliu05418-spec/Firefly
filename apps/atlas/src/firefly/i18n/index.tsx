import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { enUS } from './en-US';
import type { MessageKey, Messages } from './keys';
import { zhCN } from './zh-CN';

export type SupportedLocale = 'zh-CN' | 'en-US';

interface I18nValue {
  locale: SupportedLocale;
  t: (key: MessageKey) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const dictionaries: Record<SupportedLocale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function resolveLocale(value?: string | null): SupportedLocale {
  return value?.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

export function translate(locale: SupportedLocale, key: MessageKey): string {
  return dictionaries[locale][key] ?? dictionaries['en-US'][key] ?? key;
}

export function I18nProvider({ children, locale }: { children: ReactNode; locale?: SupportedLocale }) {
  const resolvedLocale = locale ?? resolveLocale(document.documentElement.lang || navigator.language);
  const value = useMemo<I18nValue>(() => ({
    locale: resolvedLocale,
    t: (key) => translate(resolvedLocale, key),
  }), [resolvedLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider.');
  }
  return value;
}

export type { MessageKey } from './keys';
