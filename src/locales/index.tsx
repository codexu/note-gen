import en from './en.tsx';
import zh_cn from './zh_cn.tsx';
import { Store } from '@tauri-apps/plugin-store';

export const supportedLocales = [
  { code: 'en', name: 'English', translations: en },
  { code: 'zh_cn', name: '简体中文', translations: zh_cn },
];

let currentLang: string | null = 'en'; // 初始化 currentLang 為 'en'

async function loadLanguageFromStore() {
  const store = await Store.load('store.json');
  currentLang = await store.get<string>('language') || 'en';
}

(async () => {
  await loadLanguageFromStore();
})();


export function _t(key: string, ...args: any[]): string {
  const lang = currentLang || 'en';
  const currentLocale = supportedLocales.find(locale => locale.code === lang);
  const translation = currentLocale?.translations;
  let translated = translation?.[key] ?? key;
  args.forEach((arg, index) => {
    translated = translated.replace(`$${index + 1}`, arg);
  });
  return translated;
}

export async function updateLanguage(lang: string) {
  currentLang = lang;
}
