// Supported languages list
export const locales = ['en', 'zh', 'ja'];
export const defaultLocale = 'en';

// Simple function to load messages for client-side use
export async function loadMessages(locale: string) {
  try {
    return (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    console.error(`Failed to load messages for locale: ${locale}`, error);
    // If loading fails, return English as fallback
    return (await import(`../../messages/en.json`)).default;
  }
}
