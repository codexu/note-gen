import type { AbstractIntlMessages } from 'next-intl';

export const SUPPORTED_LOCALES = ['en', 'zh', 'ja', 'pt-BR', 'zh-TW', 'de'] as const;
export type SupportedLocale = string;

export const DEFAULT_LOCALE: SupportedLocale = 'zh';
export const LANGUAGE_STORAGE_KEY = 'app-language';

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale) || getPluginLanguages().some(x => x.value === locale);
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
  const builtin = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
  let messages = await loadLocaleMessages(builtin);
  for (const [, languages] of [...pluginLanguages].sort(([a], [b]) => b.localeCompare(a))) {
    for (const language of languages) if (language.locale === locale) messages = mergeMessages(language.messages, messages);
  }

  if (locale === DEFAULT_LOCALE) {
    return messages;
  }

  const fallbackMessages = await loadLocaleMessages(DEFAULT_LOCALE);
  return mergeMessages(messages, fallbackMessages);
}

export const PLUGIN_LANGUAGES_CHANGED = 'notegen:languages-changed'
interface RegisteredLanguage { locale: string; name: string; messages: AbstractIntlMessages }
const pluginLanguages = new Map<string, RegisteredLanguage[]>()
export function getPluginLanguages() {
  const byLocale = new Map<string, { value: string; label: string }>()
  for (const [, languages] of [...pluginLanguages].sort(([a], [b]) => a.localeCompare(b))) {
    for (const language of languages) if (!byLocale.has(language.locale)) byLocale.set(language.locale, { value: language.locale, label: language.name })
  }
  return [...byLocale.values()]
}
function languageChange() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLUGIN_LANGUAGES_CHANGED)) }
export function registerPluginLanguages(id: string, languages: RegisteredLanguage[]) { pluginLanguages.set(id, languages); languageChange() }
export function unregisterPluginLanguages(id: string) { if (pluginLanguages.delete(id)) languageChange() }

export async function validateLanguageOverrides(messages: AbstractIntlMessages) {
  const { parse } = await import('@formatjs/icu-messageformat-parser')
  const fallback = await loadLocaleMessages(DEFAULT_LOCALE)
  const signature = (text: string) => {
    const argumentsUsed = new Set<string>()
    const walk = (nodes: ReturnType<typeof parse>) => {
      for (const node of nodes) {
        if (node.type !== 0 && node.type !== 7) argumentsUsed.add(`${node.type === 8 ? 'tag' : 'arg'}:${node.value}`)
        if ('options' in node) for (const option of Object.values(node.options)) walk(option.value)
        if ('children' in node) walk(node.children)
      }
    }
    walk(parse(text))
    return [...argumentsUsed].sort().join('|')
  }
  const walk = (values: AbstractIntlMessages, base: AbstractIntlMessages) => {
    for (const [key, value] of Object.entries(values)) {
      const original = base[key]
      if (typeof value === 'string') {
        const actual = signature(value)
        if (original !== undefined && (typeof original !== 'string' || signature(original) !== actual)) throw new Error(`Translation placeholders do not match: ${key}`)
      } else {
        if (typeof original === 'string') throw new Error(`Translation shape does not match: ${key}`)
        walk(value, original ?? {})
      }
    }
  }
  walk(messages, fallback)
}
