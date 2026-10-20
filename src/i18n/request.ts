import {getRequestConfig} from 'next-intl/server';
import {notFound} from 'next/navigation';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  loadMessagesWithFallback,
} from './config';

export const locales = SUPPORTED_LOCALES;
export const defaultLocale = DEFAULT_LOCALE;

export default getRequestConfig(async ({locale}) => {
  if (!locale || !isSupportedLocale(locale)) notFound();

  return {
    messages: await loadMessagesWithFallback(locale)
  };
});
