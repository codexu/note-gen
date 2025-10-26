import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';

// 加载语言文件
async function loadMessages(locale: string) {
  try {
    return (await import(`../../../messages/${locale}.json`)).default;
  } catch (error) {
    console.error(`Failed to load messages for locale: ${locale}`, error);
    // 如果加载失败，返回中文作为后备
    return (await import(`../../../messages/zh.json`)).default;
  }
}

export function NextIntlProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<any>(null);
  const [locale, setLocale] = useState<string>('zh');

  useEffect(() => {
    // 从 localStorage 获取语言设置
    const savedLocale = localStorage.getItem('app-language') || 'zh';
    setLocale(savedLocale);
    
    // 加载对应的语言文件
    loadMessages(savedLocale).then(setMessages);
  }, []);

  // 等待消息加载完成
  if (!messages) {
    return null;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
