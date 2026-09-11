'use client';

import { NextIntlClientProvider } from 'next-intl';
import type { AbstractIntlMessages } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  DEFAULT_LOCALE,
  PLUGIN_LANGUAGES_CHANGED,
  LANGUAGE_STORAGE_KEY,
  loadMessagesWithFallback,
  normalizeLocale,
  type SupportedLocale,
} from '@/i18n/config';

export function NextIntlProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<AbstractIntlMessages | null>(null);
  const [locale, setLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    let request = 0
    const refresh = () => {
      const current = ++request
      const savedLocale = normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY))
      void loadMessagesWithFallback(savedLocale).then(loaded => {
        if (current !== request) return
        setLocale(savedLocale)
        setMessages(loaded)
      }).catch(error => console.error('Failed to load language', error))
    }
    refresh()
    window.addEventListener(PLUGIN_LANGUAGES_CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => { request++; window.removeEventListener(PLUGIN_LANGUAGES_CHANGED, refresh); window.removeEventListener('storage', refresh) }
  }, []);

  if (!messages) {
    return null;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
