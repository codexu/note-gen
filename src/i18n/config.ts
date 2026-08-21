import type { AbstractIntlMessages } from 'next-intl';

export const SUPPORTED_LOCALES = ['en', 'zh', 'ja', 'pt-BR', 'zh-TW', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh';
export const LANGUAGE_STORAGE_KEY = 'app-language';

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (locale && isSupportedLocale(locale)) {
    return locale;
  }

  return DEFAULT_LOCALE;
}

function isMessageObject(value: unknown): value is AbstractIntlMessages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeMessages(
  messages: AbstractIntlMessages,
  fallbackMessages: AbstractIntlMessages
): AbstractIntlMessages {
  const merged: AbstractIntlMessages = { ...messages };

  for (const [key, fallbackValue] of Object.entries(fallbackMessages)) {
    const currentValue = merged[key];

    if (isMessageObject(currentValue) && isMessageObject(fallbackValue)) {
      merged[key] = mergeMessages(currentValue, fallbackValue);
      continue;
    }

    if (currentValue === undefined) {
      merged[key] = fallbackValue;
    }
  }

  return merged;
}

export async function loadLocaleMessages(locale: SupportedLocale): Promise<AbstractIntlMessages> {
  const [{ default: messages }, { default: commonMessages }] = await Promise.all([
    import(`../../messages/${locale}.json`),
    import(`../../messages/common/${locale}.json`),
  ]);

  return {
    ...messages,
    common: commonMessages,
  };
}

export async function loadMessagesWithFallback(
  locale: SupportedLocale
): Promise<AbstractIntlMessages> {
  const messages = await loadLocaleMessages(locale);

  if (locale === DEFAULT_LOCALE) {
    return messages;
  }

  const fallbackMessages = await loadLocaleMessages(DEFAULT_LOCALE);
  return mergeMessages(messages, fallbackMessages);
}
