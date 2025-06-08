export const languages = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸'
  },
  {
    code: 'zh',
    name: 'Chinese',
    nativeName: '中文',
    flag: '🇨🇳'
  },
  {
    code: 'ja',
    name: 'Japanese', 
    nativeName: '日本語',
    flag: '🇯🇵'
  }
];

export const defaultLanguage = 'en';

export const getLanguageByCode = (code: string) => {
  return languages.find(lang => lang.code === code) || languages[0];
}; 