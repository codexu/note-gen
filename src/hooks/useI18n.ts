import { useEffect, useState } from 'react';

const LANGUAGE_KEY = 'app-language';

export function useI18n() {
  const [currentLocale, setCurrentLocale] = useState<string>('en');

  useEffect(() => {
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY) || 'en';
    setCurrentLocale(savedLanguage);
  }, []);

  const changeLanguage = (locale: string) => {
    localStorage.setItem(LANGUAGE_KEY, locale);
    setCurrentLocale(locale);
    // Refresh page to apply new language
    window.location.reload();
  };

  return {
    currentLocale,
    changeLanguage,
  };
}
