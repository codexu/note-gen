import { useEffect, useState } from 'react';
import {
  DEFAULT_LOCALE,
  PLUGIN_LANGUAGES_CHANGED,
  LANGUAGE_STORAGE_KEY,
  isSupportedLocale,
  normalizeLocale,
  type SupportedLocale,
} from '@/i18n/config';

export function useI18n() {
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    const refresh = () => setCurrentLocale(normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY)));
    refresh();
    window.addEventListener(PLUGIN_LANGUAGES_CHANGED, refresh);
    return () => window.removeEventListener(PLUGIN_LANGUAGES_CHANGED, refresh);
  }, []);

  const changeLanguage = (locale: string) => {
    const nextLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;

    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
    setCurrentLocale(nextLocale);
    // 刷新页面以应用新语言
    window.dispatchEvent(new Event(PLUGIN_LANGUAGES_CHANGED));
  };

  return {
    currentLocale,
    changeLanguage,
  };
}
