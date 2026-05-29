/**
 * Lightweight i18n helper for non-React modules (Zustand stores, sync utilities).
 * Reads the active locale from localStorage (same key used by NextIntlProvider)
 * and returns a synchronous t() function backed by the loaded messages.
 *
 * Messages are cached per locale to avoid repeated disk reads.
 */

const CACHE = new Map<string, Record<string, any>>();

function getLocale(): string {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('app-language') || 'zh';
  }
  return 'zh';
}

function resolvePath(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

async function loadMessages(locale: string): Promise<Record<string, any>> {
  if (CACHE.has(locale)) {
    return CACHE.get(locale)!;
  }
  try {
    const mod = await import(`../../messages/${locale}.json`);
    const messages = mod.default || mod;
    CACHE.set(locale, messages);
    return messages;
  } catch {
    const fallback = await import(`../../messages/zh.json`);
    const messages = fallback.default || fallback;
    CACHE.set(locale, messages);
    return messages;
  }
}

export async function getI18n(): Promise<{ t: (key: string) => string }> {
  const locale = getLocale();
  const messages = await loadMessages(locale);
  return {
    t(key: string): string {
      const value = resolvePath(messages, key);
      if (typeof value === 'string') {
        return value;
      }
      // fallback to zh if missing in target locale
      const fallback = resolvePath(CACHE.get('zh') || messages, key);
      return fallback ?? key;
    },
  };
}

export function clearI18nCache(): void {
  CACHE.clear();
}
