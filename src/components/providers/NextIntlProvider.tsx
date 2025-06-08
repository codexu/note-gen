import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { loadMessages } from '@/i18n/request';

export function NextIntlProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<any>(null);
  const [locale, setLocale] = useState<string>('en');

  useEffect(() => {
    // Get language setting from localStorage
    const savedLocale = localStorage.getItem('app-language') || 'en';
    setLocale(savedLocale);
    
    // Load corresponding language file
    loadMessages(savedLocale).then(setMessages);
  }, []);

  // Wait for messages to load
  if (!messages) {
    return null;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
